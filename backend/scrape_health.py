import os
import re
import time
import requests
import urllib3
from bs4 import BeautifulSoup
from urllib.parse import urljoin

# 關閉 SSL 不安全連線警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def get_article_content(article_url, headers):
    """進入單一疾病頁面，提取並深度清洗內文，為 RAG 檢索作準備"""
    try:
        res = requests.get(article_url, headers=headers, timeout=10, verify=False)
        res.encoding = 'utf-8'
        
        if res.status_code != 200:
            return f"[無法讀取內容，HTTP 狀態碼: {res.status_code}]"

        soup = BeautifulSoup(res.text, 'html.parser')
        
        # 鎖定 A+ 醫學百科最精準的正文容器
        main_content = soup.find('div', id='bodyContent') or soup.find('div', id='content')

        if not main_content:
            return "[該頁面未找到文字內容]"

        # 1. 暴力拔除雜訊節點：移除目錄、底部列、分類連結、跳轉提示、右上角資訊框 (infobox)
        for junk in main_content.select('#toc, .printfooter, #catlinks, #jump-to-nav, .infobox, table.navbox, .editsection'):
            junk.decompose()
            
                # 2. 多重關鍵字攔截網：斬斷底部所有無關百科連結
        cutoff_keywords = ['參看', '健康問答網', '人體百科', '出自A+醫學百科', '更多醫學百科條目', '外部連結', '參考文獻']
        cutoff_tag = main_content.find(
            lambda tag: tag.name in ['h2', 'h3', 'div', 'p', 'b', 'span'] and 
                        any(keyword in tag.get_text() for keyword in cutoff_keywords)
        )
        if cutoff_tag:
            # 找到斷點後，將該元素及其之後的所有元素（包含同層和子節點）全部刪除
            for sibling in cutoff_tag.find_all_next():
                sibling.decompose()
            cutoff_tag.decompose()

        # 3. 提取段落文字
        # 不再單純使用 get_text()，而是只取出 p, h2, h3 等有意義的區塊
        # 避免把側邊欄或奇怪的列表連結抓進來
        content_lines = []
        for tag in main_content.find_all(['h2', 'h3', 'h4', 'p']):
            text = tag.get_text(strip=True)
            if not text:
                continue
            
            # 加入 Markdown 標題符號，保留階層
            if tag.name == 'h2':
                content_lines.append(f"\n## {text}\n")
            elif tag.name == 'h3':
                content_lines.append(f"\n### {text}\n")
            elif tag.name == 'h4':
                content_lines.append(f"\n#### {text}\n")
            elif tag.name == 'p':
                content_lines.append(text)

        text = "\n".join(content_lines)
        text = re.sub(r'\n{3,}', '\n\n', text).strip()
        
        # 防呆機制：如果抓出來的內文太短，有可能是抓錯頁面
        if len(text) < 50:
            return "[內文過短或該頁面非標準文本結構]"

        return text

    except Exception as e:
        return f"[抓取文章時發生錯誤: {e}]"

def crawl_disease_category(category_url, output_filename, headers):
    """抓取單一科別下的所有真實疾病連結並寫入檔案"""
    print(f"  進入科別頁面：{category_url}")
    res = requests.get(category_url, headers=headers, timeout=10, verify=False)
    res.encoding = 'utf-8'
    
    if res.status_code != 200:
        print(f"  頁面請求失敗，狀態碼：{res.status_code}")
        return

    soup = BeautifulSoup(res.text, 'html.parser')
    
    # 嚴格限制只在正文區塊內尋找列表連結
    main_content = soup.find('div', id='bodyContent')
    if not main_content:
        return
        
    # 🎯 關鍵修復：在解析連結前，尋找科別頁面底部的導覽斷點（例如：「更多呼吸內科疾病條目請參看...」）
    # 一旦找到該段落，立刻銷毀該段落及其後面的所有 DOM 節點，防止抓取過頭
    cutoff_element = main_content.find(
        lambda tag: tag.name in ['p', 'div', 'h2', 'h3', 'span', 'li'] and 
                    (('請參看' in tag.get_text() and '分類頁面' in tag.get_text()) or
                     ('更多' in tag.get_text() and '請參看' in tag.get_text()))
    )
    
    if cutoff_element:
        print("  [資訊] 偵測到科別頁面底部導覽提示，截斷後續無關內容。")
        for sibling in cutoff_element.find_all_next():
            sibling.decompose()
        cutoff_element.decompose()

    # 截斷後才搜尋所有 valid 連結
    all_links = main_content.select("ul li a[href]")

    visited_urls = set()
    valid_articles = []

    for a in all_links:
        href = a['href'].strip()
        title = a.get_text(strip=True)

        # 過濾掉無效標題、系統頁面，或是誤抓到的「子分類」
        if not title or "分類:" in title or title.startswith("A+醫學百科"):
            continue
        if "index.php" in href or "action=" in href:
            continue
        # 關鍵防護：避免把下一層的分類目錄（如：呼吸內科疾病）當作疾病抓取
        if title.endswith("疾病") or title.endswith("專題") or title.endswith("分類頁面"): 
            continue

        full_url = urljoin(category_url, href)

        if full_url not in visited_urls:
            visited_urls.add(full_url)
            valid_articles.append({"title": title, "url": full_url})

    total_count = len(valid_articles)
    print(f"  找到 {total_count} 個真實疾病，開始寫入 {output_filename}...")
    
    # 確保輸出目錄存在於 backend 資料夾下
    os.makedirs(os.path.join("backend", "data", "knowledge"), exist_ok=True)
    file_path = os.path.join("backend", "data", "knowledge", output_filename)

    with open(file_path, "w", encoding="utf-8") as f:
        for index, item in enumerate(valid_articles, 1):
            print(f"    [{index}/{total_count}] 抓取：{item['title']}")
            
            # Fetch the actual content of the disease
            content = get_article_content(item["url"], headers)

            f.write(f"【疾病 {index}】 {item['title']}\n")
            f.write(f"文章網址：{item['url']}\n")
            f.write("--- 完整內容 ---\n")
            f.write(f"{content}\n")
            f.write("\n" + "=" * 60 + "\n\n")

            time.sleep(0.5)

def crawl_entire_encyclopedia(main_index_url):
    """從總覽頁面分段抓取指定科別"""
    print("🔍 開始解析全站主目錄...")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    
    res = requests.get(main_index_url, headers=headers, verify=False)
    res.encoding = 'utf-8'
    soup = BeautifulSoup(res.text, 'html.parser')
    
    all_links = soup.find_all('a', href=True)
    
    # 建立開關標記
    start_crawling = False
    
    for a in all_links:
        dept_name = a.get_text(strip=True)
        
        # 起點：碰到「呼吸內科疾病」打開開關
        if dept_name == "急診科疾病":
            start_crawling = True
            
        if start_crawling:
            # 確保只抓取以「疾病」結尾的有效科別分類，排除過長的不合理標題
            if dept_name.endswith("疾病") and len(dept_name) <= 10:
                dept_url = urljoin(main_index_url, a['href'])
                output_filename = f"{dept_name}.txt"
                
                print(f"\n📂 準備開始爬取科別：{dept_name}")
                crawl_disease_category(dept_url, output_filename, headers)
                
                time.sleep(3)
                
            # 終點：抓完「腫瘤科疾病」後強制關閉迴圈
            if dept_name == "營養科疾病":
                print("\n🎉 已到達指定終點，分段爬取任務完成！")
                break

if __name__ == "__main__":
    master_url = "https://cht.a-hospital.com/w/%E7%96%BE%E7%97%85" 
    crawl_entire_encyclopedia(master_url)