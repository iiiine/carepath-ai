import os
import uuid

from datetime import (
    datetime,
    timedelta,
    timezone,
)

import jwt

from jwt.exceptions import (
    InvalidTokenError,
)

from pwdlib import PasswordHash

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    status,
)

from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
)

from psycopg2.extras import (
    RealDictCursor,
)

from models import (
    UserRegister,
    UserLogin,
    UserPublic,
    TokenResponse,
)

from rate_limit import (
    client_key,
    guest_login_limiter,
)

from services import (
    get_db_connection,
)


# ============================================================
# Router
# ============================================================

router = APIRouter(
    prefix="/api/v1/auth",
    tags=["Auth"],
)


# ============================================================
# JWT 設定
# ============================================================

SECRET_KEY = os.getenv(
    "AUTH_SECRET_KEY"
)


if not SECRET_KEY:

    raise RuntimeError(
        "找不到 AUTH_SECRET_KEY，"
        "請先在後端 .env 設定"
    )


ALGORITHM = "HS256"


ACCESS_TOKEN_EXPIRE_MINUTES = int(
    os.getenv(
        "AUTH_TOKEN_EXPIRE_MINUTES",
        "1440",
    )
)


# ============================================================
# 密碼雜湊
# ============================================================

password_hash = (
    PasswordHash.recommended()
)


# ------------------------------------------------------------
# 防止不存在帳號和存在帳號的
# password verification 時間差距過大
# ------------------------------------------------------------

DUMMY_HASH = password_hash.hash(
    "dummy-password"
)


def hash_password(
    password: str,
):

    return password_hash.hash(
        password
    )


def verify_password(
    plain_password: str,
    hashed_password: str,
):

    return password_hash.verify(
        plain_password,
        hashed_password,
    )


# ============================================================
# JWT
# ============================================================

def create_access_token(
    subject,
    actor_type: str = "user",
):
    """
    建立 JWT。

    subject：
    - users table：user id
    - guest_sessions：guest UUID

    actor_type：
    - user
    - guest

    注意：
    actor_type = user
    不代表一定是正式會員。

    users.is_guest = TRUE
    仍然代表該 user 是訪客帳號。
    """

    expire = (
        datetime.now(
            timezone.utc
        )
        +
        timedelta(
            minutes=(
                ACCESS_TOKEN_EXPIRE_MINUTES
            )
        )
    )


    payload = {

        "sub":
            str(
                subject
            ),

        "actor_type":
            actor_type,

        "exp":
            expire,
    }


    token = jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


    return token


# ============================================================
# Bearer Token
# ============================================================

security = HTTPBearer(
    auto_error=False
)


# ============================================================
# Current User
# ============================================================

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(
        security
    ),
):
    """
    解析目前登入身分。

    系統目前支援兩種來源：

    ----------------------------------------------------------
    A. actor_type == "guest"
    ----------------------------------------------------------

    使用 guest_sessions UUID Session。

    ----------------------------------------------------------
    B. actor_type == "user"
    ----------------------------------------------------------

    使用 users table。

    users table 中又可能是：

    is_guest = FALSE
        → 正式會員

    is_guest = TRUE
        → 訪客型使用者

    ----------------------------------------------------------

    重要：
    actor_type == "user"
    絕對不能直接推論為正式會員。

    是否為 Guest，
    最終必須依資料庫的 is_guest 判斷。
    """

    # ========================================================
    # 1. Authorization Header
    # ========================================================

    if credentials is None:

        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail="請先登入",
        )


    token = (
        credentials.credentials
    )


    # ========================================================
    # 2. Decode JWT
    # ========================================================

    try:

        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[
                ALGORITHM
            ],
        )


        subject = payload.get(
            "sub"
        )


        actor_type = payload.get(
            "actor_type",
            "user",
        )


        if not subject:

            raise HTTPException(
                status_code=(
                    status.HTTP_401_UNAUTHORIZED
                ),
                detail="登入憑證無效",
            )


    except InvalidTokenError:

        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail="登入憑證無效或已過期",
        )


    # ========================================================
    # 3. Database
    # ========================================================

    conn = get_db_connection()


    if not conn:

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail="無法連線至資料庫",
        )


    try:

        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:


            # =================================================
            # A. guest_sessions 型訪客
            # =================================================

            if actor_type == "guest":

                try:

                    guest_id = uuid.UUID(
                        str(
                            subject
                        )
                    )


                except (
                    ValueError,
                    TypeError,
                    AttributeError,
                ):

                    raise HTTPException(
                        status_code=(
                            status.HTTP_401_UNAUTHORIZED
                        ),
                        detail="訪客憑證格式錯誤",
                    )


                # ---------------------------------------------
                # 查 Guest Session
                # ---------------------------------------------

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
                    (
                        str(
                            guest_id
                        ),
                    ),
                )


                guest = (
                    cur.fetchone()
                )


                # ---------------------------------------------
                # Session 不存在
                # ---------------------------------------------

                if not guest:

                    raise HTTPException(
                        status_code=(
                            status.HTTP_401_UNAUTHORIZED
                        ),
                        detail="找不到訪客 Session",
                    )


                # ---------------------------------------------
                # Session 已停用
                # ---------------------------------------------

                if not guest[
                    "is_active"
                ]:

                    raise HTTPException(
                        status_code=(
                            status.HTTP_401_UNAUTHORIZED
                        ),
                        detail="此訪客 Session 已失效",
                    )


                now = datetime.now(
                    timezone.utc
                )


                # ---------------------------------------------
                # Session 過期
                # ---------------------------------------------

                if (
                    guest[
                        "expires_at"
                    ]
                    and
                    guest[
                        "expires_at"
                    ] < now
                ):

                    raise HTTPException(
                        status_code=(
                            status.HTTP_401_UNAUTHORIZED
                        ),
                        detail="訪客 Session 已過期",
                    )


                # ---------------------------------------------
                # Guest 已經轉移成會員
                # ---------------------------------------------

                if (
                    guest[
                        "migrated_to_user_id"
                    ]
                    is not None
                ):

                    raise HTTPException(
                        status_code=(
                            status.HTTP_401_UNAUTHORIZED
                        ),
                        detail="此訪客資料已轉移至會員",
                    )


                # ---------------------------------------------
                # 更新最後活動時間
                # ---------------------------------------------

                cur.execute(
                    """
                    UPDATE guest_sessions
                    SET
                        last_seen_at = CURRENT_TIMESTAMP
                    WHERE id = %s;
                    """,
                    (
                        str(
                            guest_id
                        ),
                    ),
                )


                conn.commit()


                return {

                    "id":
                        str(
                            guest[
                                "id"
                            ]
                        ),

                    "username":
                        (
                            "Guest_"
                            +
                            str(
                                guest[
                                    "id"
                                ]
                            )[
                                :8
                            ]
                        ),

                    "email":
                        None,

                    "is_guest":
                        True,

                    "actor_type":
                        "guest",
                }


            # =================================================
            # B. users table 型使用者
            # =================================================

            try:

                user_id = int(
                    subject
                )


            except (
                TypeError,
                ValueError,
            ):

                raise HTTPException(
                    status_code=(
                        status.HTTP_401_UNAUTHORIZED
                    ),
                    detail="會員憑證格式錯誤",
                )


            # ---------------------------------------------
            # 從 DB 取得真正身分
            # ---------------------------------------------

            cur.execute(
                """
                SELECT
                    id,
                    username,
                    email,
                    is_active,
                    COALESCE(
                        is_guest,
                        FALSE
                    ) AS is_guest
                FROM users
                WHERE id = %s;
                """,
                (
                    user_id,
                ),
            )


            user = (
                cur.fetchone()
            )


            # ---------------------------------------------
            # User 不存在
            # ---------------------------------------------

            if not user:

                raise HTTPException(
                    status_code=(
                        status.HTTP_401_UNAUTHORIZED
                    ),
                    detail="找不到使用者",
                )


            # ---------------------------------------------
            # 帳號停用
            # ---------------------------------------------

            if not user[
                "is_active"
            ]:

                raise HTTPException(
                    status_code=(
                        status.HTTP_403_FORBIDDEN
                    ),
                    detail="此帳號已停用",
                )


            # =================================================
            # ★ Guest Identity Fix
            #
            # 原本錯誤：
            #
            # "is_guest": False
            #
            # 導致：
            #
            # DB:
            # users.is_guest = TRUE
            #
            # ↓
            #
            # get_current_user()
            #
            # ↓
            #
            # is_guest = False
            #
            # ↓
            #
            # Guest 被錯誤當成正式會員。
            #
            # 現在直接採用 PostgreSQL 的實際值。
            # =================================================

            is_guest = bool(
                user[
                    "is_guest"
                ]
            )


            return {

                "id":
                    user[
                        "id"
                    ],

                "username":
                    user[
                        "username"
                    ],

                "email":
                    user[
                        "email"
                    ],

                "is_guest":
                    is_guest,

                "actor_type":
                    "user",
            }


    finally:

        conn.close()


# ============================================================
# Register
# ============================================================

@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    payload: UserRegister,
):

    username = (
        payload.username
        .strip()
    )


    email = (
        str(
            payload.email
        )
        .strip()
        .lower()
    )


    conn = get_db_connection()


    if not conn:

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail="無法連線至資料庫",
        )


    try:

        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:


            # =================================================
            # 檢查 Username
            # =================================================

            cur.execute(
                """
                SELECT
                    id
                FROM users
                WHERE
                    LOWER(username)
                    =
                    LOWER(%s);
                """,
                (
                    username,
                ),
            )


            if cur.fetchone():

                raise HTTPException(
                    status_code=(
                        status.HTTP_409_CONFLICT
                    ),
                    detail="此帳號已被使用",
                )


            # =================================================
            # 檢查 Email
            # =================================================

            cur.execute(
                """
                SELECT
                    id
                FROM users
                WHERE
                    LOWER(email)
                    =
                    LOWER(%s);
                """,
                (
                    email,
                ),
            )


            if cur.fetchone():

                raise HTTPException(
                    status_code=(
                        status.HTTP_409_CONFLICT
                    ),
                    detail="此 Email 已被註冊",
                )


            # =================================================
            # Password Hash
            # =================================================

            hashed = hash_password(
                payload.password
            )


            # =================================================
            # 建立正式會員
            #
            # 明確設定 is_guest = FALSE
            # =================================================

            cur.execute(
                """
                INSERT INTO users
                (
                    username,
                    email,
                    password_hash,
                    is_guest
                )
                VALUES
                (
                    %s,
                    %s,
                    %s,
                    FALSE
                )
                RETURNING
                    id,
                    username,
                    email,
                    is_guest;
                """,
                (
                    username,
                    email,
                    hashed,
                ),
            )


            user = (
                cur.fetchone()
            )


        conn.commit()


    except HTTPException:

        conn.rollback()

        raise


    except Exception as exc:

        conn.rollback()


        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "註冊失敗，請稍後再試。"
            ),
        )


    finally:

        conn.close()


    # ========================================================
    # JWT
    # ========================================================

    token = create_access_token(
        subject=user[
            "id"
        ],
        actor_type="user",
    )


    return {

        "access_token":
            token,

        "token_type":
            "bearer",

        "user":
            {

                "id":
                    user[
                        "id"
                    ],

                "username":
                    user[
                        "username"
                    ],

                "email":
                    user[
                        "email"
                    ],

                "is_guest":
                    bool(
                        user.get(
                            "is_guest",
                            False,
                        )
                    ),
            },
    }


# ============================================================
# Login
# ============================================================

@router.post(
    "/login",
    response_model=TokenResponse,
)
def login(
    payload: UserLogin,
):

    identifier = (
        payload.identifier
        .strip()
    )


    conn = get_db_connection()


    if not conn:

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail="無法連線至資料庫",
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
                    is_active,
                    COALESCE(
                        is_guest,
                        FALSE
                    ) AS is_guest
                FROM users
                WHERE
                    LOWER(username)
                    =
                    LOWER(%s)
                OR
                    LOWER(email)
                    =
                    LOWER(%s)
                LIMIT 1;
                """,
                (
                    identifier,
                    identifier,
                ),
            )


            user = (
                cur.fetchone()
            )


    finally:

        conn.close()


    # ========================================================
    # 帳號不存在
    # ========================================================

    if not user:

        # ----------------------------------------------------
        # 防止帳號存在與不存在產生明顯 timing difference
        # ----------------------------------------------------

        password_hash.verify(
            payload.password,
            DUMMY_HASH,
        )


        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail="帳號 / Email 或密碼錯誤",
        )


    # ========================================================
    # Password
    # ========================================================

    if not verify_password(
        payload.password,
        user[
            "password_hash"
        ],
    ):

        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail="帳號 / Email 或密碼錯誤",
        )


    # ========================================================
    # Active
    # ========================================================

    if not user[
        "is_active"
    ]:

        raise HTTPException(
            status_code=(
                status.HTTP_403_FORBIDDEN
            ),
            detail="此帳號已停用",
        )


    # ========================================================
    # Guest 型 user 不允許使用正式會員密碼登入
    #
    # 正常 Guest 密碼為隨機產生，
    # 理論上不會走到這裡。
    # ========================================================

    is_guest = bool(
        user.get(
            "is_guest",
            False,
        )
    )


    # ========================================================
    # JWT
    # ========================================================

    token = create_access_token(
        subject=user[
            "id"
        ],
        actor_type="user",
    )


    return {

        "access_token":
            token,

        "token_type":
            "bearer",

        "user":
            {

                "id":
                    user[
                        "id"
                    ],

                "username":
                    user[
                        "username"
                    ],

                "email":
                    user[
                        "email"
                    ],

                "is_guest":
                    is_guest,
            },
    }


# ============================================================
# Current User API
# ============================================================

@router.get(
    "/me",
    response_model=UserPublic,
)
def get_me(
    current_user=Depends(
        get_current_user
    ),
):

    return {

        "id":
            current_user[
                "id"
            ],

        "username":
            current_user[
                "username"
            ],

        "email":
            current_user.get(
                "email"
            ),

        "is_guest":
            bool(
                current_user.get(
                    "is_guest",
                    False,
                )
            ),
    }


# ============================================================
# Guest Login
#
# 目前前端使用的是 users-table Guest。
#
# 也就是：
#
# users.is_guest = TRUE
#
# JWT：
# actor_type = user
#
# 之後 get_current_user()
# 會再從 DB 的 is_guest 判斷真正 Guest 身分。
# ============================================================

@router.post(
    "/guest-login",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
)
def guest_login(
    request: Request,
):
    """
    建立匿名訪客帳號。

    此 Guest：
    - 存在 users table
    - is_guest = TRUE
    - 有 JWT
    - 無法知道隨機產生的密碼
    """

    # ========================================================
    # 0. 速率限制
    #
    # 這支是完全匿名的寫入端點：每呼叫一次就往 users 塞一列，
    # 而拿到的 token 可以直接打 /diagnose 消耗 Gemini 額度。
    # 沒有任何限制的話，一個迴圈就能同時灌爆資料表與 API 額度。
    #
    # 限制是行程內計數（見 rate_limit.py 對多實例的但書），
    # 擋的是反覆呼叫，不是分散式攻擊。
    # ========================================================

    allowed, retry_after = (
        guest_login_limiter.check(
            client_key(
                request
            )
        )
    )


    if not allowed:

        print(
            "⚠️ [RateLimit] guest-login 超出限制，"
            f"來源 {client_key(request)}，"
            f"建議 {int(retry_after)} 秒後重試"
        )

        raise HTTPException(
            status_code=(
                status.HTTP_429_TOO_MANY_REQUESTS
            ),
            detail=(
                "訪客身分建立過於頻繁，請稍後再試。"
            ),
            headers={
                "Retry-After": str(
                    max(
                        int(retry_after),
                        1,
                    )
                ),
            },
        )


    # ========================================================
    # 1. 建立匿名識別資料
    # ========================================================

    unique_id = (
        uuid.uuid4()
        .hex[
            :8
        ]
    )


    guest_username = (
        f"Guest_{unique_id}"
    )


    guest_email = (
        f"guest_{unique_id}"
        "@anonymous.local"
    )


    # ========================================================
    # 2. Database
    # ========================================================

    conn = get_db_connection()


    if not conn:

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail="無法連線至資料庫",
        )


    try:

        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:


            # ------------------------------------------------
            # Guest 使用完全隨機密碼
            # 使用者本身不知道這個密碼
            # ------------------------------------------------

            dummy_hashed = (
                hash_password(
                    uuid.uuid4().hex
                )
            )


            cur.execute(
                """
                INSERT INTO users
                (
                    username,
                    email,
                    password_hash,
                    is_guest
                )
                VALUES
                (
                    %s,
                    %s,
                    %s,
                    TRUE
                )
                RETURNING
                    id,
                    username,
                    email,
                    is_guest;
                """,
                (
                    guest_username,
                    guest_email,
                    dummy_hashed,
                ),
            )


            user = (
                cur.fetchone()
            )


        conn.commit()


    except Exception as exc:

        conn.rollback()


        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "訪客登入建立失敗，請稍後再試。"
            ),
        )


    finally:

        conn.close()


    # ========================================================
    # 3. JWT
    #
    # actor_type 仍然是 user，
    # 因為 subject 指向 users.id。
    #
    # 是否 Guest 由 users.is_guest 判斷。
    # ========================================================

    token = create_access_token(
        subject=user[
            "id"
        ],
        actor_type="user",
    )


    # ========================================================
    # 4. Response
    # ========================================================

    return {

        "access_token":
            token,

        "token_type":
            "bearer",

        "user":
            {

                "id":
                    user[
                        "id"
                    ],

                "username":
                    user[
                        "username"
                    ],

                "email":
                    user[
                        "email"
                    ],

                "is_guest":
                    True,
            },
    }