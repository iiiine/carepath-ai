#抓向量資料庫 爬蟲 目標網址:A+醫學百科
import os
import time
import requests
import urllib3
from bs4 import BeautifulSoup
from urllib.parse import urljoin

# 關閉 SSL 不安全連線警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def get_article_content(article_url, headers):
    """進入單一疾病頁面，提取詳細內文"""
    try:
        res = requests.get(article_url, headers=headers, timeout=10, verify=False)
        res.encoding = 'utf-8'
        
        if res.status_code != 200:
            return f"[無法讀取內容，HTTP 狀態碼: {res.status_code}]"

        soup = BeautifulSoup(res.text, 'html.parser')

        # 尋找內文主要區塊 (常見的內文容器)
        main_content = (
            soup.find('article') or 
            soup.find('main') or 
            soup.find('div', class_='content') or 
            soup.find('div', id='content') or 
            soup.find('div', class_='article-body')
        )

        if main_content:
            # 取得該區塊內所有文字
            text = main_content.get_text(separator='\n', strip=True)
        else:
            # 備用方案：抓取頁面上所有的 <p> 段落
            paragraphs = soup.find_all('p')
            text = "\n".join([p.get_text(strip=True) for p in paragraphs if p.get_text(strip=True)])

        return text if text else "[該頁面未找到文字內容]"

    except Exception as e:
        return f"[抓取文章時發生錯誤: {e}]"

def crawl_all_eye_diseases(target_url, output_filename="eye_diseases_all.txt"):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    print(f"1. 正在讀取總覽頁面：{target_url}")
    response = requests.get(target_url, headers=headers, timeout=10, verify=False)
    response.encoding = 'utf-8'

    if response.status_code != 200:
        print(f"總覽頁請求失敗，狀態碼：{response.status_code}")
        return

    soup = BeautifulSoup(response.text, 'html.parser')

    # 抓取包含疾病連結的所有 <a> 標籤 (排除無效連結或錨點)
    all_links = soup.select("ul li a[href]")
    if not all_links:
        all_links = soup.find_all('a', href=True)

    # 用來過濾重複連結
    visited_urls = set()
    valid_articles = []

    for a in all_links:
        href = a['href'].strip()
        title = a.get_text(strip=True) or a.get('title', '').strip()

        if "分類" in title and "頁面" in title:
            break
        if title == "分類":
            break
        # 過濾掉無效標題或純導覽連結
        if not title or title in ["上一頁", "下一頁", "回首頁", "Top", "::marker"]:
            continue
        if href.startswith("javascript:") or href.startswith("#"):
            continue

        full_url = urljoin(target_url, href)

        if full_url not in visited_urls:
            visited_urls.add(full_url)
            valid_articles.append({"title": title, "url": full_url})

    total_count = len(valid_articles)
    print(f"2. 共找到 {total_count} 個疾病項目，開始依序爬取內文...\n")

    file_path = os.path.join("data", "knowledge", output_filename)

    with open(file_path, "w", encoding="utf-8") as f:
        for index, item in enumerate(valid_articles, 1):
            title = item["title"]
            url = item["url"]

            print(f"[{index}/{total_count}] 正在抓取：{title}")

            # 抓取個別文章內文
            content = get_article_content(url, headers)

            # 寫入單一 txt 檔案
            f.write(f"【疾病 {index}】 {title}\n")
            f.write(f"文章網址：{url}\n")
            f.write("--- 完整內容 ---\n")
            f.write(f"{content}\n")
            f.write("\n" + "=" * 60 + "\n\n")

            # 禮貌性延遲 0.3 秒，避免請求頻率過高導致伺服器封鎖
            time.sleep(0.3)

    print(f"\n全部爬取完成！共收錄 {total_count} 篇疾病文章，已合併寫入：{file_path}")

if __name__ == "__main__":
    # 1. 填入你圖片中這個總覽頁面的網址
    target_url = "https://cht.a-hospital.com/w/%E7%B2%BE%E7%A5%9E%E5%BF%83%E7%90%86%E7%A7%91%E7%96%BE%E7%97%85"  # <-- 請替換成你實際的總覽頁網址
    
    # 2. 自訂輸出 txt 檔名
    output_filename = "mental.txt"

    crawl_all_eye_diseases(target_url, output_filename)