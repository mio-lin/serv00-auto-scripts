import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import axios from 'axios';
import { fileURLToPath } from 'url';

function formatToISO(date) {
    return date.toISOString().replace('T', ' ').replace('Z', '').replace(/\.\d{3}Z/, '');
}

async function delayTime(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTelegramMessage(token, chatId, message) {
    if (!token || !chatId) return;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(url, { chat_id: chatId, text: message });
    } catch (error) {
        console.error('Telegram 消息發送失敗');
    }
}

(async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, '../accounts.json'), 'utf-8'));
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    for (const account of accounts) {
        const { username, password, panel } = account;

        const browser = await puppeteer.launch({ 
            headless: "new", 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled' // 隱藏自動化特徵
            ]
        });
        
        const page = await browser.newPage();
        // 模擬真實瀏覽器，避免被 Cloudflare 直接拒絕
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        let url = `https://${panel}/login/?next=/`;

try {
            console.log(`[${username}] 正在連線至 ${url}...`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });

            const title = await page.title();
            console.log(`[${username}] 目前頁面標題: ${title}`);

            // 1. 等待輸入框（確保進入 Sign in 頁面）
            await page.waitForSelector('#id_username', { visible: true, timeout: 60000 });

            await page.type('#id_username', username, { delay: 100 });
            await page.type('#id_password', password, { delay: 100 });

            // 2. 修正：針對按鈕的「全能型」尋找策略
            // 不僅等 selector，還直接檢查頁面上的所有按鈕
            console.log(`[${username}] 正在定位登入按鈕...`);
            
            const btnSelector = 'button.button--primary, button[type="submit"], input[type="submit"]';
            
            // 這裡將 visible 設為 false，只要它在 DOM 裡面出現就抓取，增加成功率
            await page.waitForSelector(btnSelector, { timeout: 30000 });

            // 3. 採用「暴力點擊」：直接在瀏覽器環境執行 JS 提交表單，繞過所有 UI 阻礙
            await page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (btn) {
                    btn.click();
                    // 額外保險：如果 click 沒反應，直接提交它所在的 form
                    if (btn.form) btn.form.submit();
                }
            }, btnSelector);
            
            console.log(`[${username}] 已送出登入指令`);

            // 4. 等待跳轉（Serv00 跳轉有時較慢，放寬到 60s）
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

            // 檢查是否包含「登出」字樣或連結
            const isLoggedIn = await page.evaluate(() => {
                return document.body.innerText.includes('Logout') || 
                       document.body.innerText.includes('Wyloguj') || 
                       document.querySelector('a[href="/logout/"]') !== null;
            });
            if (isLoggedIn) {
                const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000));
                console.log(`[${username}] 台灣時間 ${nowBeijing} 登錄成功！`);
                await sendTelegramMessage(telegramToken, telegramChatId, `帳號 ${username} 登錄成功！`);
            } else {
                throw new Error('未偵測到登出按鈕，可能密碼錯誤或登錄失敗');
            }

        } catch (error) {
            console.error(`[${username}] 錯誤: ${error.message}`);
            // 如果失敗，可以考慮在這裡加上 page.screenshot 以便在 Actions 產物中查看
            if (telegramToken && telegramChatId) {
                await sendTelegramMessage(telegramToken, telegramChatId, `帳號 ${username} 登錄失敗: ${error.message}`);
            }
        } finally {
            await page.close();
            await browser.close();
            await delayTime(2000);
        }
    }
})();
