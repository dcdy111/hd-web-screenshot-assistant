'use strict';
// 通用高清网页截图助手：Playwright + Chrome / Edge + CDP
// 仅截图当前用户打开的网页；不自动登录，不读取、上传账号或截图数据。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const DEFAULT_URL = 'http://43.139.69.134:18080/'; // 回车默认打开瞳序，不限制其他网站。
const MAX_PIXELS = 45_000_000; // 防止超长高倍率截图耗尽内存。

function normalizeUrl(input, fallback = DEFAULT_URL) {
  let raw = String(input ?? '').trim();
  if (!raw) raw = fallback;
  if (!/^https?:\/\//i.test(raw)) {
    if (/^[a-z][\w+.-]*:\/\//i.test(raw) || /^(?:javascript|data|file):/i.test(raw)) {
      throw new Error('仅支持 http:// 或 https:// 网页地址');
    }
    // 内网、本地服务及纯 IPv4:端口默认 HTTP；普通域名默认 HTTPS。
    // 这样输入 43.139.69.134:18080 不会被误补成 https:// 导致访问失败。
    const localOrIp = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(raw)
      || /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[\/?#]|$)/.test(raw);
    raw = (localOrIp ? 'http://' : 'https://') + raw;
  }
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('地址无效，请输入完整网址'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('仅支持 http:// 或 https:// 网页地址');
  }
  if (parsed.username || parsed.password) throw new Error('网址中不要直接包含登录账号或密码');
  return parsed.href;
}

function parseArgs(argv) {
  const args = {
    url: null, width: 1600, height: 900, dpr: 4, fixedViewport: false,
    outDir: path.join(__dirname, 'output', 'hd-screenshots'),
    // 登录态存储到本机用户目录，避免意外把 Cookies 随截图工具压缩包分享出去。
    profileDir: path.join(process.env.LOCALAPPDATA || path.join(__dirname, '.local'), 'HDWebScreenshotAssistant', 'browser-profile'),
    once: '', headless: false, browser: 'auto', selfTest: false,
  };
  for (const item of argv.slice(2)) {
    if (item.startsWith('--url=')) args.url = item.slice(6);
    else if (item.startsWith('--width=')) { args.width = Number(item.slice(8)); args.fixedViewport = true; }
    else if (item.startsWith('--height=')) { args.height = Number(item.slice(9)); args.fixedViewport = true; }
    else if (item.startsWith('--dpr=')) args.dpr = Number(item.slice(6));
    else if (item.startsWith('--out=')) args.outDir = path.resolve(item.slice(6));
    else if (item.startsWith('--profile=')) args.profileDir = path.resolve(item.slice(10));
    else if (item.startsWith('--once=')) args.once = item.slice(7).toLowerCase();
    else if (item.startsWith('--browser=')) args.browser = item.slice(10).toLowerCase();
    else if (item === '--headless') args.headless = true;
    else if (item === '--self-test') args.selfTest = true;
    else if (!item.startsWith('--')) args.url = item;
    else throw new Error(`未知参数: ${item}`);
  }
  if (!Number.isInteger(args.width) || args.width < 400 || args.width > 4000) throw new Error('浏览器宽度需在 400–4000 之间');
  if (!Number.isInteger(args.height) || args.height < 300 || args.height > 3000) throw new Error('浏览器高度需在 300–3000 之间');
  if (!Number.isInteger(args.dpr) || args.dpr < 1 || args.dpr > 5) throw new Error('高清倍率 dpr 需为 1–5');
  if (!['', 'pdf', 'pdf-snapshot', 'pdf-vector', 'pdf-full', 'viewport', 'full', 'both'].includes(args.once)) throw new Error('无效 --once 参数');
  if (!['auto', 'chrome', 'msedge', 'chromium'].includes(args.browser)) throw new Error('无效 --browser 参数');
  return args;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

async function obtainUrl(args) {
  if (args.url != null) return normalizeUrl(args.url);
  if (!process.stdin.isTTY) return normalizeUrl('');
  console.log('');
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║         通用高清网页截图助手 · v2.1          ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log('每次启动都可以输入不同的网站；直接回车打开瞳序。');
  console.log(`默认网址：${DEFAULT_URL}`);
  for (;;) {
    const raw = await ask('\n请输入网址（回车使用默认网址）：');
    try { return normalizeUrl(raw); }
    catch (e) { console.log('地址错误：' + e.message); }
  }
}

function timestamp() {
  const d = new Date();
  const pad = (n, nDigits = 2) => String(n).padStart(nDigits, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(),3)}`;
}

function safeName(url) {
  try {
    const u = new URL(url);
    // 不把 query、fragment、URL 凭据写入截图文件名。
    return (u.hostname + (u.pathname === '/' ? '' : '-' + u.pathname))
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 66) || 'page';
  } catch { return 'page'; }
}

function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.subarray(0,8).toString('hex') !== '89504e470d0a1a0a')
    throw new Error('浏览器返回的截图不是有效 PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function metrics(page, args) {
  return page.evaluate((fallback) => {
    const root = document.documentElement;
    const body = document.body;
    const vv = window.visualViewport;
    return {
      viewportWidth: Math.max(1, Math.ceil(window.innerWidth || vv?.width || fallback.width)),
      viewportHeight: Math.max(1, Math.ceil(window.innerHeight || vv?.height || fallback.height)),
      scrollWidth: Math.max(window.innerWidth || fallback.width, root?.scrollWidth || 0, body?.scrollWidth || 0),
      scrollHeight: Math.max(window.innerHeight || fallback.height, root?.scrollHeight || 0, body?.scrollHeight || 0),
      scrollX: Math.max(0, vv?.pageLeft ?? window.scrollX ?? 0),
      scrollY: Math.max(0, vv?.pageTop ?? window.scrollY ?? 0),
      zoom: Math.round((vv?.scale || 1) * 100),
    };
  }, { width: args.width, height: args.height });
}

function guardPixels(cssW, cssH, scale) {
  const w = Math.ceil(cssW * scale), h = Math.ceil(cssH * scale);
  if (w * h > MAX_PIXELS || w > 32000 || h > 32000) {
    throw new Error(`截图过大：预计 ${w}×${h} 像素。请改用“框选PNG”、当前屏截图，或降低 --dpr 值`);
  }
}

function overlayScript(dpr, secret = '') {
  return `(() => {
    const mount = () => {
    if (window.top !== window || !document.documentElement || document.getElementById('hd-assistant-root')) return;
    const trustedToken = ${JSON.stringify(secret)};
    const handlers = {capture: window.__hdCapture, snapshot: window.__hdSnapshot, vector: window.__hdVector};
    const invoke = (which, opts = {}) => handlers[which]({...opts, __hdToken: trustedToken});
    const root = document.createElement('div'); root.id='hd-assistant-root';
    root.style.cssText='position:fixed;top:66px;right:16px;z-index:2147483647;max-width:370px;background:rgba(255,255,255,.97);padding:8px;border:1px solid #94a3b8;border-radius:12px;box-shadow:0 10px 28px #0003;display:flex;gap:5px;flex-wrap:wrap;align-items:center;font:13px system-ui,sans-serif;color:#0f172a';
    const label=document.createElement('span');label.textContent='截图 HD ×${dpr}';label.style.cssText='font-weight:700;padding:5px';root.append(label);
    const status=document.createElement('span');status.style.cssText='width:100%;font:11px system-ui;color:#64748b';status.textContent='截图自动隐藏工具条 · 文件保存到 output 目录';
    const makeBtn=(name, act, title)=>{
      const b=document.createElement('button');b.type='button';b.textContent=name;b.title=title||name;
      b.style.cssText='background:#1659c5;border:0;color:white;border-radius:7px;padding:7px 9px;font:12px system-ui;cursor:pointer';
      b.addEventListener('click',async(e)=>{e.preventDefault();e.stopPropagation();b.disabled=true;const old=b.textContent;b.textContent='保存中';
        try {const r=await act(); status.textContent='已保存：'+(r.filePath||r.companionPngPath||'完成');b.textContent='完成';}
        catch(err){status.textContent='失败：'+err.message;b.textContent='失败';console.error(err);}
        setTimeout(()=>{b.textContent=old;b.disabled=false},1400);
      });root.append(b);return b;
    };
    const selectRect=()=>new Promise((resolve,reject)=>{
      const mask=document.createElement('div');mask.id='hd-select-mask';mask.style.cssText='position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:#0f172a18';
      const tip=document.createElement('span');tip.textContent='拖拽框选需要的区域 · Esc 取消';tip.style.cssText='position:absolute;top:20px;left:50%;transform:translateX(-50%);background:#111827;color:white;padding:9px;border-radius:8px;font:14px system-ui';mask.append(tip);
      const box=document.createElement('div');box.style.cssText='position:absolute;border:2px solid #2563eb;background:#2563eb23;pointer-events:none;display:none';mask.append(box);
      const prev=root.style.visibility;root.style.visibility='hidden';document.documentElement.append(mask);
      let sx=0,sy=0,pressed=false;
      const cleanup=()=>{window.removeEventListener('keydown',onKey,true);mask.remove();root.style.visibility=prev};
      const onKey=(e)=>{if(e.key==='Escape'){e.preventDefault();cleanup();reject(new Error('框选取消'))}};
      window.addEventListener('keydown',onKey,true);
      mask.addEventListener('pointerdown',e=>{e.preventDefault();sx=e.clientX;sy=e.clientY;pressed=true;try{mask.setPointerCapture(e.pointerId)}catch{}});
      mask.addEventListener('pointermove',e=>{if(!pressed)return; const x=Math.min(sx,e.clientX),y=Math.min(sy,e.clientY),w=Math.abs(sx-e.clientX),h=Math.abs(sy-e.clientY);
        Object.assign(box.style,{display:'block',left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
      });
      mask.addEventListener('pointerup',e=>{if(!pressed)return;pressed=false;const rect={x:Math.round(Math.min(sx,e.clientX)),y:Math.round(Math.min(sy,e.clientY)),width:Math.round(Math.abs(sx-e.clientX)),height:Math.round(Math.abs(sy-e.clientY))};cleanup();
        if(rect.width<20||rect.height<20)reject(new Error('选区太小'));else resolve(rect);
      });
    });
    makeBtn('当前屏PNG',()=>invoke('capture', {}),'最适合Word和PPT');
    makeBtn('框选PNG',async()=>invoke('capture', {rect:await selectRect()}),'截取局部，保持真实像素');
    makeBtn('整页PNG',()=>invoke('capture', {fullPage:true}),'过长页面建议降低DPR');
    makeBtn('当前屏PDF',()=>invoke('snapshot', {}),'嵌入PNG的视觉快照PDF');
    makeBtn('框选PDF',async()=>invoke('snapshot', {rect:await selectRect()}),'嵌入高清截图的局部PDF');
    makeBtn('打印PDF',()=>invoke('vector', {fullPage:true}),'尽量保留网页文字矢量属性；排版可能变化');
    const hide=document.createElement('button');hide.textContent='—';hide.title='隐藏/展开工具栏';hide.style.cssText='border:1px solid #94a3b8;border-radius:5px;background:#f1f5f9;padding:5px;cursor:pointer';
    let collapsed=false;
    hide.onclick=()=>{collapsed=!collapsed;[...root.children].forEach(c=>{if(c!==label&&c!==hide)c.style.display=collapsed?'none':''});hide.textContent=collapsed?'+':'—'};
    root.append(hide);root.append(status);document.documentElement.append(root);
    if(!window.__HD_SHOT_HOTKEY_SET__){window.__HD_SHOT_HOTKEY_SET__=true;
      window.addEventListener('keydown',async(e)=>{
        const hot=(e.altKey&&e.shiftKey)||(e.ctrlKey&&e.altKey);if(!hot)return;
        let work=null;
        if(e.code==='KeyS')work=()=>invoke('capture', {});
        else if(e.code==='KeyF')work=()=>invoke('capture', {fullPage:true});
        else if(e.code==='KeyP')work=()=>invoke('snapshot', {});
        if(work){e.preventDefault();try{await work()}catch(err){console.error('[截图失败]',err)}}
      },true);
    }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true});
    else mount();
  })();`;
}

async function hiddenToolbar(page, action) {
  // 元素使用明确的 ID，截图时隐藏工具条，保证图片不是“软件里带了截图按钮”。
  const mark = await page.evaluate(() => {
    const el = document.getElementById('hd-assistant-root');
    if (!el) return null;
    const previous = el.style.visibility;
    el.style.visibility = 'hidden';
    return previous;
  }).catch(() => null);
  const hasToolbar = mark !== null;
  const waitForPaint = () => page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })).catch(() => {});
  if (hasToolbar) await waitForPaint();
  try { return await action(); }
  finally {
    await page.evaluate((previous) => {
      const el = document.getElementById('hd-assistant-root');
      if (el) el.style.visibility = previous == null ? '' : previous;
    }, mark).catch(() => {});
    if (hasToolbar) await waitForPaint();
  }
}

async function captureBuffer(page, args, options={}) {
  const sizes = await metrics(page, args);
  const viewport = page.viewportSize() || {width: sizes.viewportWidth, height: sizes.viewportHeight};
  const regionRequested = options.rect && Number.isFinite(Number(options.rect.width)) ? {
    x: Math.max(0, Math.floor(Number(options.rect.x)||0)),
    y: Math.max(0, Math.floor(Number(options.rect.y)||0)),
    width: Math.ceil(Number(options.rect.width)),
    height: Math.ceil(Number(options.rect.height)),
  } : null;
  // 框选使用浏览器可视区坐标，严格限制到可见边界。
  const region = regionRequested ? {
    x: Math.min(regionRequested.x, viewport.width - 1),
    y: Math.min(regionRequested.y, viewport.height - 1),
    width: Math.min(regionRequested.width, viewport.width - regionRequested.x),
    height: Math.min(regionRequested.height, viewport.height - regionRequested.y),
  } : null;
  const full = Boolean(options.fullPage) && !region;
  const cssWidth = region ? region.width : full ? sizes.scrollWidth : viewport.width;
  const cssHeight = region ? region.height : full ? sizes.scrollHeight : viewport.height;
  if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth < 1 || cssHeight < 1)
    throw new Error('截图区域无效，框选范围必须在浏览器可视区域内');
  guardPixels(cssWidth, cssHeight, args.dpr);
  // The interactive browser uses the monitor's real viewport (viewport:null).
  // CDP applies the requested export scale to that viewport without resizing the
  // visible window. CDP clip coordinates are document coordinates, so a region
  // selected with clientX/clientY must include the current scroll offset.
  const clip = full ? {
    x: 0, y: 0, width: sizes.scrollWidth, height: sizes.scrollHeight
  } : {
    x: sizes.scrollX + (region ? region.x : 0),
    y: sizes.scrollY + (region ? region.y : 0),
    width: cssWidth, height: cssHeight
  };
  const client = await page.context().newCDPSession(page);
  let buffer;
  try {
    // Measure the screenshot surface itself. window.devicePixelRatio also
    // changes with browser zoom, while CDP's base output scale does not.
    const probeWidth = Math.min(64, viewport.width);
    const probeHeight = Math.min(64, viewport.height);
    const probe = await client.send('Page.captureScreenshot', {
      format:'png', fromSurface:true, captureBeyondViewport:true,
      clip:{x:sizes.scrollX,y:sizes.scrollY,width:probeWidth,height:probeHeight,scale:1}
    });
    const probePixel = pngSize(Buffer.from(probe.data, 'base64'));
    const surfaceScale = (probePixel.width/probeWidth + probePixel.height/probeHeight)/2;
    if (!Number.isFinite(surfaceScale) || surfaceScale <= 0) throw new Error('无法校准浏览器截图倍率');
    const captureScale = args.dpr / surfaceScale;
    const shot = await client.send('Page.captureScreenshot', {
      format:'png', fromSurface:true, captureBeyondViewport:true,
      clip:{...clip, scale:captureScale}
    });
    buffer = Buffer.from(shot.data, 'base64');
  } finally { await client.detach().catch(()=>{}); }
  const pixel = pngSize(buffer);
  const expectedW = Math.round(cssWidth * args.dpr), expectedH = Math.round(cssHeight * args.dpr);
  if (Math.abs(pixel.width-expectedW)>Math.max(4,expectedW*.025) || Math.abs(pixel.height-expectedH)>Math.max(4,expectedH*.025))
    throw new Error(`截图尺寸异常：实际 ${pixel.width}×${pixel.height}，预期约 ${expectedW}×${expectedH}。已取消保存，避免得到含大面积空白的文件。`);
  return {buffer,cssWidth,cssHeight,pixel,full,region,zoom:sizes.zoom};
}

function createName(page, tag, extension) {
  return `${timestamp()}-${safeName(page.url())}-${tag}.${extension}`;
}

async function capturePage(page,args,options={}) {
  fs.mkdirSync(args.outDir,{recursive:true});
  const shot = await hiddenToolbar(page,()=>captureBuffer(page,args,options));
  const type = shot.region ? 'region' : shot.full ? 'full' : 'viewport';
  const filePath=path.join(args.outDir,createName(page,`${type}-${shot.pixel.width}x${shot.pixel.height}`, 'png'));
  fs.writeFileSync(filePath, shot.buffer);
  console.log(`\n[PNG 已保存] ${filePath}\n原始截图像素：${shot.pixel.width}×${shot.pixel.height}`);
  return {filePath,actualWidth:shot.pixel.width,actualHeight:shot.pixel.height};
}

async function snapshotPdf(page,args,options={}) {
  fs.mkdirSync(args.outDir,{recursive:true});
  const shot=await hiddenToolbar(page,()=>captureBuffer(page,args,options));
  const mode=shot.region?'region':'viewport';
  const base=path.join(args.outDir,createName(page,`snapshot-${mode}-${shot.pixel.width}x${shot.pixel.height}`,'pdf'));
  const companionPngPath=base.replace(/\.pdf$/i,'.png');
  fs.writeFileSync(companionPngPath,shot.buffer);
  const temp=await page.context().newPage();
  try {
    const {cssWidth:w,cssHeight:h}=shot;
    // Persistent browser contexts share their viewport; resizing this temporary page can shrink the source page after a regional PDF export.
    const html=`<!doctype html><html><head><style>@page{size:${w}px ${h}px;margin:0}html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden}img{width:100%;height:100%;display:block}</style></head><body><img src="data:image/png;base64,${shot.buffer.toString('base64')}"></body></html>`;
    await temp.setContent(html,{waitUntil:'load'});
    await temp.pdf({path:base,printBackground:true,preferCSSPageSize:true,margin:{top:0,bottom:0,left:0,right:0}});
  } finally {await temp.close().catch(()=>{});}
  console.log(`\n[快照 PDF 已保存] ${base}\n[同内容 PNG] ${companionPngPath}`);
  return {filePath:base,companionPngPath};
}

async function vectorPdf(page,args,options={}) {
  fs.mkdirSync(args.outDir,{recursive:true});
  const fullPage=Boolean(options.fullPage);
  const size=await metrics(page,args);
  const cssWidth=fullPage?size.scrollWidth:size.viewportWidth;
  const cssHeight=fullPage?size.scrollHeight:size.viewportHeight;
  const filePath=path.join(args.outDir,createName(page,`print-vector-${fullPage?'full':'viewport'}-${cssWidth}x${cssHeight}`,'pdf'));
  await hiddenToolbar(page,async()=>{
    await page.evaluate(({width,height})=>{
      const id='hd-assistant-print-page-size';
      document.getElementById(id)?.remove();
      const style=document.createElement('style');
      style.id=id;
      style.textContent='@page { size: '+width+'px '+height+'px; margin: 0; }';
      document.head.appendChild(style);
    },{width:cssWidth,height:cssHeight}).catch(()=>{});
    const client=await page.context().newCDPSession(page);
    try {
      // 保持屏幕样式，避免目标站点的 print CSS 把界面隐藏成空白 PDF。
      await client.send('Emulation.setEmulatedMedia',{media:'screen'}).catch(()=>{});
      const result=await client.send('Page.printToPDF',{
        printBackground:true,
        landscape:false,
        paperWidth:Math.max(cssWidth/96,1),
        paperHeight:Math.max(cssHeight/96,1),
        marginTop:0,
        marginBottom:0,
        marginLeft:0,
        marginRight:0,
        scale:1,
        preferCSSPageSize:true,
        displayHeaderFooter:false,
      });
      fs.writeFileSync(filePath,Buffer.from(result.data,'base64'));
    } finally {
      await client.send('Emulation.setEmulatedMedia',{media:''}).catch(()=>{});
      await page.evaluate(()=>document.getElementById('hd-assistant-print-page-size')?.remove()).catch(()=>{});
      await client.detach().catch(()=>{});
    }
  });
  console.log(`\n[打印 PDF 已保存] ${filePath}（保留屏幕样式，矢量内容取决于网页本身）`);
  return {filePath,cssWidth,cssHeight,format:'pdf',fullPage};
}

async function runCommand(page,args,mode) {
  const command=String(mode||'').trim().toLowerCase();
  if(['p','pdf','pdf-snapshot'].includes(command))return snapshotPdf(page,args);
  if(['pv','pdf-vector'].includes(command))return vectorPdf(page,args,{fullPage:false});
  if(['pf','pdf-full'].includes(command))return vectorPdf(page,args,{fullPage:true});
  if(['f','full'].includes(command))return capturePage(page,args,{fullPage:true});
  if(['b','both'].includes(command))return {pdf:await snapshotPdf(page,args),png:await capturePage(page,args)};
  return capturePage(page,args);
}

async function launchBrowser(args,profileDir) {
  const fitScreen=!args.headless&&!args.fixedViewport;
  const base={headless:args.headless,locale:'zh-CN',
    viewport:fitScreen?null:{width:args.width,height:args.height},
    ...(args.headless?{deviceScaleFactor:args.dpr,screen:{width:args.width,height:args.height}}:{}),
    args:fitScreen?['--start-maximized']:[`--window-size=${args.width+30},${args.height+110}`]};
  const options=args.browser==='auto'?['chrome','msedge','chromium']:[args.browser];
  const reasons=[];
  for(const channel of options){
    try {
      const ctx=await chromium.launchPersistentContext(profileDir,{
        ...base,...(channel==='chromium'?{}:{channel}),
        ...(process.env.HD_BROWSER_EXECUTABLE && channel==='chromium' ? {executablePath:process.env.HD_BROWSER_EXECUTABLE} : {})
      });
      console.log(`使用浏览器：${channel==='chrome'?'Google Chrome':channel==='msedge'?'Microsoft Edge':'Playwright Chromium'}`);
      return ctx;
    }catch(e){
      const brief=String(e.message||e).split('\n')[0];reasons.push(`${channel}: ${brief}`);
    }
  }
  throw new Error('找不到可启动的 Chrome / Edge / Chromium 浏览器。请先安装 Chrome 或 Edge；如果使用内置 Chromium，运行 npx playwright install chromium。\n'+reasons.join('\n'));
}

async function main() {
  const args=parseArgs(process.argv);
  if(args.selfTest){
    const assert=require('assert');
    assert.strictEqual(normalizeUrl('www.example.com'),'https://www.example.com/');
    assert.strictEqual(normalizeUrl('localhost:4173'),'http://localhost:4173/');
    assert.strictEqual(normalizeUrl('43.139.69.134:18080'),'http://43.139.69.134:18080/');
    assert.strictEqual(normalizeUrl('192.168.1.20:8080'),'http://192.168.1.20:8080/');
    assert.strictEqual(normalizeUrl(''),DEFAULT_URL);
    assert(!safeName('https://example.org/path?token=abc#hash').includes('token'));
    assert.throws(()=>normalizeUrl('file:///C:/passwords.txt'));
    guardPixels(800,600,4);
    assert.throws(()=>guardPixels(10000,10000,4));
    console.log('参数、网址处理与像素限额单元测试通过。');return;
  }
  args.url=await obtainUrl(args);
  fs.mkdirSync(args.outDir,{recursive:true});
  const temporary=Boolean(args.once);
  const profileDir=temporary?path.join(args.profileDir,`once-${process.pid}`):args.profileDir;
  fs.mkdirSync(path.dirname(profileDir),{recursive:true});
  const ctx=await launchBrowser(args,profileDir);
  let closed=false;
  let active=null;
  let markClosed;
  const closedPromise = new Promise(resolve => {markClosed=resolve;});
  ctx.once('close',()=>{closed=true;markClosed();process.stdin.pause();console.log('浏览器已关闭，截图助手结束。');});
  const token = crypto.randomBytes(24).toString('hex');
  const busyPages = new WeakSet();
  const exclusive = async (page, options, fn) => {
    if (options?.__hdToken !== token) throw new Error('禁止网页脚本直接请求截图，请使用截图工具栏');
    if (busyPages.has(page)) throw new Error('当前截图还在导出中，请稍后再试');
    busyPages.add(page);
    try {return await fn();} finally {busyPages.delete(page);}
  };
  await ctx.exposeBinding('__hdCapture',(source,opts)=>exclusive(source.page,opts,()=>capturePage(source.page,args,opts||{})));
  await ctx.exposeBinding('__hdSnapshot',(source,opts)=>exclusive(source.page,opts,()=>snapshotPdf(source.page,args,opts||{})));
  await ctx.exposeBinding('__hdVector',(source,opts)=>exclusive(source.page,opts,()=>vectorPdf(source.page,args,opts||{})));
  const barScript = overlayScript(args.dpr,token);
  await ctx.addInitScript({content:barScript});
  const attached = new WeakSet();
  const attach = (p) => {
    if (attached.has(p)) return;
    attached.add(p);
    active=p;
    p.on('domcontentloaded',()=>{active=p;p.evaluate(barScript).catch(()=>{});});
  };
  ctx.on('page',attach);
  for (const p of ctx.pages()) attach(p);
  const page=ctx.pages()[0]||await ctx.newPage();attach(page);
  try{
    await page.goto(args.url,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(500);
    await page.evaluate(barScript).catch(()=>{});
    console.log(`成功打开：${page.url()}`);
  }catch(e){
    if(temporary){await ctx.close().catch(()=>{}); throw new Error('目标网页未能成功加载，已取消自动截图：'+e.message);}
    console.warn('网页加载遇到问题，浏览器仍可手动输入地址重试：'+e.message);
  }
  if(temporary){
    try{await runCommand(page,args,args.once);}finally{await ctx.close().catch(()=>{});fs.rmSync(profileDir,{recursive:true,force:true});}
    return;
  }
  console.log(`\n截图保存位置：${args.outDir}`);
  console.log('推荐：页面右上角使用“当前屏PNG”或“框选PNG”，适合放入 Word/PPT。');
  console.log('快捷键：Alt+Shift+S 当前屏PNG，Alt+Shift+F 整页PNG，Alt+Shift+P 快照PDF。');
  console.log('终端命令：回车 截当前屏；p 快照PDF；pv 打印PDF；f 整页；b PNG+PDF。');
  console.log('支持浏览器内导航到任何其他网址，关闭浏览器即可结束。\n');
  if(process.stdin.isTTY){
    const commandInput = readline.createInterface({input:process.stdin,terminal:false});
    let queue=Promise.resolve();
    commandInput.on('line',input=>{
      queue=queue.then(async()=>{
        if(closed)return;
        const target=(active&&!active.isClosed()?active:ctx.pages().find(p=>!p.isClosed()));
        if(!target){console.error('当前没有可截图的页面');return;}
        try{await runCommand(target,args,input);}catch(e){console.error('导出失败：'+e.message);}
      });
    });
  }
  await closedPromise;
}

if(require.main===module){main().catch(e=>{console.error('\n错误：'+(e.stack||e.message));process.exitCode=1;});}
module.exports={normalizeUrl,parseArgs,safeName,guardPixels,overlayScript,captureBuffer,capturePage,snapshotPdf,vectorPdf};
