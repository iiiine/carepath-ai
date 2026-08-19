import os
from datetime import datetime, timedelta, timezone

import jwt
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash

import uuid
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
)

from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
)

try:
    from psycopg2.extras import RealDictCursor
except Exception:  # pragma: no cover - fallback for environments without psycopg2
    # Provide a lightweight fallback for type compatibility in environments
    # where psycopg2 is not available (e.g., linting or static analysis).
    RealDictCursor = dict

from models import (
    UserRegister,
    UserLogin,
    UserPublic,
    TokenResponse,
)

from services import get_db_connection


router = APIRouter(
    prefix="/api/v1/auth",
    tags=["Auth"]
)


# =========================
# JWT 設定
# =========================

SECRET_KEY = os.getenv("AUTH_SECRET_KEY")

if not SECRET_KEY:
    raise RuntimeError(
        "找不到 AUTH_SECRET_KEY，請先在後端 .env 設定"
    )

ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = int(
    os.getenv("AUTH_TOKEN_EXPIRE_MINUTES", "1440")
)


# =========================
# 密碼雜湊
# =========================

password_hash = PasswordHash.recommended()

# 防止不存在帳號和存在帳號的驗證時間差異過大
DUMMY_HASH = password_hash.hash("dummy-password")


def hash_password(password: str):
    return password_hash.hash(password)


def verify_password(
    plain_password: str,
    hashed_password: str
):
    return password_hash.verify(
        plain_password,
        hashed_password
    )


# =========================
# JWT
# =========================

def create_access_token(
    subject,
    actor_type: str = "user",
    expires_minutes: int = None
):
    if expires_minutes is None:
        expires_minutes = ACCESS_TOKEN_EXPIRE_MINUTES

    expire = datetime.now(timezone.utc) + timedelta(
        minutes=expires_minutes
    )

    payload = {
        "sub": str(subject),
        "actor_type": actor_type,
        "exp": expire,
    }

    token = jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM
    )

    return token


# =========================
# Bearer Token
# =========================

security = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="請先登入"
        )

    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        subject = payload.get("sub")
        actor_type = payload.get("actor_type", "user")

        if not subject:
            raise HTTPException(
                status_code=401,
                detail="登入憑證無效"
            )

    except InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登入憑證無效或已過期"
        )

    conn = get_db_connection()

    if not conn:
        raise HTTPException(
            status_code=500,
            detail="無法連線至資料庫"
        )

    try:
        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:

            # =========================
            # 訪客
            # =========================
            if actor_type == "guest":
                try:
                    guest_id = uuid.UUID(subject)
                except ValueError:
                    raise HTTPException(
                        status_code=401,
                        detail="訪客憑證格式錯誤"
                    )

                cur.execute(
                    """
                    SELECT
                        id,
                        is_active,
                        expires_at,
                        migrated_to_user_id,
                        migrated_at
                    FROM guest_sessions
                    WHERE id = %s;
                    """,
                    (str(guest_id),)
                )

                guest = cur.fetchone()

                if not guest:
                    raise HTTPException(
                        status_code=401,
                        detail="找不到訪客 Session"
                    )

                if not guest["is_active"]:
                    raise HTTPException(
                        status_code=401,
                        detail="此訪客 Session 已失效"
                    )

                now = datetime.now(timezone.utc)

                if (
                    guest["expires_at"]
                    and guest["expires_at"] < now
                ):
                    raise HTTPException(
                        status_code=401,
                        detail="訪客 Session 已過期"
                    )

                if guest["migrated_to_user_id"] is not None:
                    raise HTTPException(
                        status_code=401,
                        detail="此訪客資料已轉移至會員"
                    )

                # 更新最後活動時間
                cur.execute(
                    """
                    UPDATE guest_sessions
                    SET last_seen_at = CURRENT_TIMESTAMP
                    WHERE id = %s;
                    """,
                    (str(guest_id),)
                )

                conn.commit()

                return {
                    "id": str(guest["id"]),
                    "username": f"Guest_{str(guest['id'])[:8]}",
                    "email": None,
                    "is_guest": True,
                    "actor_type": "guest"
                }

            # =========================
            # 正式會員
            # =========================
            try:
                user_id = int(subject)
            except (TypeError, ValueError):
                raise HTTPException(
                    status_code=401,
                    detail="會員憑證格式錯誤"
                )

            cur.execute(
                """
                SELECT
                    id,
                    username,
                    email,
                    is_active,
                    is_guest
                FROM users
                WHERE id = %s;
                """,
                (user_id,)
            )

            user = cur.fetchone()

            if not user:
                raise HTTPException(
                    status_code=401,
                    detail="找不到使用者"
                )

            if not user["is_active"]:
                raise HTTPException(
                    status_code=403,
                    detail="此帳號已停用"
                )

            return {
                "id": user["id"],
                "username": user["username"],
                "email": user["email"],
                "is_guest": False,
                "actor_type": "user"
            }

    finally:
        conn.close()


# =========================
# 註冊
# =========================

@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=201
)
def register(payload: UserRegister):

    username = payload.username.strip()
    email = str(payload.email).strip().lower()

    conn = get_db_connection()

    if not conn:
        raise HTTPException(
            status_code=500,
            detail="無法連線至資料庫"
        )

    try:

        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:

            # 檢查帳號
            cur.execute(
                """
                SELECT id
                FROM users
                WHERE LOWER(username) = LOWER(%s);
                """,
                (username,)
            )

            if cur.fetchone():

                raise HTTPException(
                    status_code=409,
                    detail="此帳號已被使用"
                )

            # 檢查 Email
            cur.execute(
                """
                SELECT id
                FROM users
                WHERE LOWER(email) = LOWER(%s);
                """,
                (email,)
            )

            if cur.fetchone():

                raise HTTPException(
                    status_code=409,
                    detail="此 Email 已被註冊"
                )

            hashed = hash_password(
                payload.password
            )

            cur.execute(
                """
                INSERT INTO users
                (
                    username,
                    email,
                    password_hash
                )
                VALUES (%s, %s, %s)
                RETURNING
                    id,
                    username,
                    email;
                """,
                (
                    username,
                    email,
                    hashed
                )
            )

            user = cur.fetchone()

        conn.commit()

    except HTTPException:

        conn.rollback()
        raise

    except Exception as e:

        conn.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"註冊失敗：{str(e)}"
        )

    finally:
        conn.close()

    token = create_access_token(
        user["id"]
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user
    }


# =========================
# 登入
# =========================

@router.post(
    "/login",
    response_model=TokenResponse
)
def login(payload: UserLogin):

    identifier = payload.identifier.strip()

    conn = get_db_connection()

    if not conn:
        raise HTTPException(
            status_code=500,
            detail="無法連線至資料庫"
        )

    try:

        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:

            cur.execute(
                """
                SELECT
                    id,
                    username,
                    email,
                    password_hash,
                    is_active
                FROM users
                WHERE
                    LOWER(username) = LOWER(%s)
                    OR
                    LOWER(email) = LOWER(%s)
                LIMIT 1;
                """,
                (
                    identifier,
                    identifier
                )
            )

            user = cur.fetchone()

    finally:
        conn.close()

    if not user:

        # 執行一次 hash 驗證避免明顯時間差
        password_hash.verify(
            payload.password,
            DUMMY_HASH
        )

        raise HTTPException(
            status_code=401,
            detail="帳號 / Email 或密碼錯誤"
        )

    if not verify_password(
        payload.password,
        user["password_hash"]
    ):

        raise HTTPException(
            status_code=401,
            detail="帳號 / Email 或密碼錯誤"
        )

    if not user["is_active"]:

        raise HTTPException(
            status_code=403,
            detail="此帳號已停用"
        )

    token = create_access_token(
        user["id"]
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"]
        }
    }


# =========================
# 目前登入使用者
# =========================

@router.get(
    "/me",
    response_model=UserPublic
)
def get_me(
    current_user=Depends(get_current_user)
):
    return {
        "id": current_user["id"],
        "username": current_user["username"],
        "email": current_user.get("email"),
        "is_guest": current_user.get("is_guest", False)
    }

# =========================
# 訪客登入 (Guest Login)
# =========================

@router.post(
    "/guest-login",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED
)
def guest_login():
    """
    產生臨時訪客帳號並回傳 JWT Token
    """
    # 產生不重複的匿名訪客名稱與 Email
    unique_id = uuid.uuid4().hex[:8]
    guest_username = f"Guest_{unique_id}"
    guest_email = f"guest_{unique_id}@anonymous.local"
    
    conn = get_db_connection()
    if not conn:
        raise HTTPException(
            status_code=500,
            detail="無法連線至資料庫"
        )

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 建立訪客帳號，is_guest 設為 True，密碼給隨機雜湊
            dummy_hashed = hash_password(uuid.uuid4().hex)
            
            cur.execute(
                """
                INSERT INTO users (username, email, password_hash, is_guest)
                VALUES (%s, %s, %s, TRUE)
                RETURNING id, username, email, is_guest;
                """,
                (guest_username, guest_email, dummy_hashed)
            )
            user = cur.fetchone()

        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"訪客登入建立失敗：{str(e)}"
        )
    finally:
        conn.close()

    # 發放該訪客的 JWT Token
    token = create_access_token(user["id"])

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user
    }