'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {capturePage,captureBuffer,snapshotPdf,vectorPdf,chooseCaptureDpr,overlayScript}=require('../hd-screenshot-assistant');

async function pixelAt(page, buffer, x, y) {
  const dataUrl=`data:image/png;base64,${buffer.toString('base64')}`;
  return page.evaluate(async ({dataUrl,x,y})=>{
    const image=new Image();
    image.src=dataUrl;
    await image.decode();
    const canvas=document.createElement('canvas');
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(image,0,0);
    return Array.from(context.getImageData(x,y,1,1).data);
  },{dataUrl,x,y});
}

async function containsRgb(page, buffer, color) {
  const dataUrl=`data:image/png;base64,${buffer.toString('base64')}`;
  return page.evaluate(async ({dataUrl,color})=>{
    const image=new Image();
    image.src=dataUrl;
    await image.decode();
    const canvas=document.createElement('canvas');
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(image,0,0);
    const data=context.getImageData(0,0,canvas.width,canvas.height).data;
    for(let i=0;i<data.length;i+=4){
      if(data[i]===color[0]&&data[i+1]===color[1]&&data[i+2]===color[2])return true;
    }
    return false;
  },{dataUrl,color});
}

async function main() {
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'hd-screenshot-e2e-'));
  const outDir=path.join(work,'screenshots');
  const executable=process.env.HD_BROWSER_EXECUTABLE;
  const ctx=await chromium.launchPersistentContext(path.join(work,'profile'),{
    headless:true,
    ...(executable?{executablePath:executable}:{channel:'chrome'}),
    viewport:{width:640,height:480},screen:{width:640,height:480},deviceScaleFactor:2,
    ...(process.platform==='linux'?{args:['--no-sandbox']}:{})
  });
  try {
    const page=ctx.pages()[0]||await ctx.newPage();
    const args={width:640,height:480,dpr:2,headless:true,outDir};
    const token='e2e-only';
    let clicks=0;
    await ctx.exposeBinding('__hdCapture',(source,opts)=>{
      assert.equal(opts.__hdToken,token);
      clicks++;
      return capturePage(source.page,args,opts);
    });
    await ctx.exposeBinding('__hdSnapshot',(source,opts)=>snapshotPdf(source.page,args,opts));
    await ctx.exposeBinding('__hdVector',()=>Promise.resolve({filePath:'test'}));
    await ctx.addInitScript({content:overlayScript(2,token)});
    const attachToolbar=p=>p.on('domcontentloaded',()=>p.evaluate(overlayScript(2,token)).catch(()=>{}));
    ctx.on('page',attachToolbar);
    for(const existing of ctx.pages())attachToolbar(existing);
    await page.goto('about:blank#first');
    await page.setContent('<html><style>html,body{margin:0;background:#f94;height:100%}</style><body>Continuous screenshot regression</body></html>');
    await page.evaluate(overlayScript(2,token));
    await page.locator('#hd-assistant-root').waitFor();
    assert.equal(await page.locator('#hd-assistant-root button').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(22, 89, 197)');
    const one=await capturePage(page,args);
    assert.equal(one.actualWidth,1280);
    assert.equal(one.actualHeight,960);
    assert.equal(await containsRgb(page,fs.readFileSync(one.filePath),[22,89,197]),false,
      'saved PNG must exclude the floating toolbar buttons');
    assert.equal(await page.locator('#hd-assistant-root').evaluate(el=>getComputedStyle(el).visibility),'visible',
      'toolbar must reappear after capture');
    const crop=await capturePage(page,args,{rect:{x:100,y:50,width:280,height:200}});
    assert.equal(crop.actualWidth,560);
    assert.equal(crop.actualHeight,400);

    await page.setContent(`<!doctype html><style>
      html,body{margin:0;width:1800px;height:1400px;background:#fff}
      .marker{position:fixed;width:160px;height:120px}
      #red{left:20px;top:20px;background:#ff0000}
      #green{left:220px;top:20px;background:#00ff00}
      #blue{left:20px;top:180px;background:#0000ff}
    </style><div id="red" class="marker"></div><div id="green" class="marker"></div><div id="blue" class="marker"></div>`);
    await page.evaluate(overlayScript(2,token));
    await page.evaluate(()=>window.scrollTo(200,160));
    await page.waitForFunction(()=>window.scrollX===200&&window.scrollY===160);
    const scrolledCrop=await captureBuffer(page,args,{rect:{x:10,y:10,width:100,height:100}});
    assert.equal(scrolledCrop.pixel.width,200);
    assert.equal(scrolledCrop.pixel.height,200);
    assert.deepEqual(await pixelAt(page,scrolledCrop.buffer,100,100),[255,0,0,255],
      'a viewport selection must keep the top-left marker after the document scrolls');

    await page.setContent(`<!doctype html><style>
      html,body{margin:0;width:1800px;height:1400px;background:#fff}
      .page{box-sizing:border-box;position:absolute;left:0;top:0;width:522px;height:382px;
        border:2px solid #334155;background:#eef2ff;padding:18px}
      .hidden-outside{position:absolute;left:1600px;top:1300px;width:100px;height:80px;background:#f00;opacity:0}
    </style><main class="page"><h1>Visible page content</h1><p>Keep the card edge and crop the blank viewport.</p></main><div class="hidden-outside"></div>`);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForFunction(()=>window.scrollX===0&&window.scrollY===0);
    const trimmedFull=await captureBuffer(page,args,{fullPage:true});
    assert.deepEqual([trimmedFull.cssWidth,trimmedFull.cssHeight],[538,398],
      'full-page capture must crop viewport-sized blank space to the painted content edge');
    const trimmedViewport=await captureBuffer(page,args);
    assert.deepEqual([trimmedViewport.cssWidth,trimmedViewport.cssHeight],[640,480],
      'current-screen native capture must reflect exactly the visible browser viewport');
    const trimmedRegion=await captureBuffer(page,args,{rect:{x:20,y:20,width:600,height:440}});
    assert.deepEqual([trimmedRegion.cssWidth,trimmedRegion.cssHeight],[600,440],
      'user-selected region must keep its exact dimensions even when blank background is inside selection');

    await page.setContent(`<!doctype html><style>
      html,body{margin:0;width:1800px;height:1400px;background:#fff}
      .fixed-shell{position:fixed;inset:0;background:#f6f7f9}
      .fixed-page{box-sizing:border-box;position:absolute;left:0;top:0;width:522px;height:382px;
        border:2px solid #334155;background:#eef2ff;padding:18px}
    </style><div class="fixed-shell"><main class="fixed-page"><h1>Fixed application shell</h1><p>The page card still determines the visible content boundary.</p></main></div>`);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForFunction(()=>window.scrollX===0&&window.scrollY===0);
    const fixedShell=await captureBuffer(page,args);
    assert.deepEqual([fixedShell.cssWidth,fixedShell.cssHeight],[640,480],
      'fixed shells must be captured as actually visible; precise trimming is the user-selected mode');

    await page.setContent('<iframe id="content-frame"></iframe>');
    await page.locator('#content-frame').evaluate(frame=>{
      frame.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;border:0';
      frame.srcdoc='<!doctype html><style>html,body{margin:0;width:1800px;height:1400px;background:#fff}.page{box-sizing:border-box;position:absolute;left:0;top:0;width:522px;height:382px;border:2px solid #334155;background:#eef2ff;padding:18px}</style><main class="page"><h1>Embedded page content</h1><p>Measure the visible page inside the full-window frame.</p></main>';
    });
    await page.frameLocator('#content-frame').locator('.page').waitFor();
    const iframeContent=await captureBuffer(page,args);
    assert.deepEqual([iframeContent.cssWidth,iframeContent.cssHeight],[640,480],
      'visible iframe content must remain in the exact current viewport without CDP offsets');

    // Regression for the reported multi-monitor screenshot: the DOM's
    // nearly-transparent full-size shell reaches the viewport edge, but the
    // actual app panel ends much earlier, leaving a wide blank right/bottom.
    await page.setContent(`<!doctype html><style>
      html,body{margin:0;width:640px;height:480px;background:#f4f7f9}
      .phantom{position:absolute;left:120px;top:0;width:518px;height:478px;
        border:1px solid rgba(0,0,0,.001);pointer-events:none}
      .app{box-sizing:border-box;width:500px;height:370px;
        background:#fff;border:2px solid #254269}
    </style><div class="phantom"></div><main class="app"><h1>Working dashboard</h1><p>Trim empty background, not the visible application.</p></main>`);
    const noBlank=await captureBuffer(page,args);
    assert.deepEqual([noBlank.cssWidth,noBlank.cssHeight],[640,480],
      'native current screen preserves the real viewport rather than heuristically cropping');
    assert.equal(noBlank.pixel.width,1280,
      'actual browser device pixels are used without fabricated upscale');

    await page.setContent('<html><style>html,body{margin:0;background:#f94;height:100%}</style><body>Continuous screenshot regression</body></html>');
    await page.evaluate(overlayScript(2,token));
    await page.getByRole('button',{name:'当前屏PNG'}).click();
    await page.waitForFunction(()=>document.querySelector('#hd-assistant-root')?.innerText.includes('已保存：'));
    assert.equal(clicks,1);
    await page.reload(); // The toolbar must return after full reload without manual reinjection.
    await page.locator('#hd-assistant-root').waitFor();
    await page.getByRole('button',{name:'当前屏PNG'}).click();
    await page.waitForTimeout(450);
    assert.equal(clicks,2,'toolbar screenshot after reload');
    const two=await capturePage(page,args);
    assert.equal(two.actualWidth,1280);
    assert.notEqual(one.filePath,two.filePath);
    const pdf=await snapshotPdf(page,args);
    assert.equal(fs.existsSync(pdf.filePath),true);
    assert.equal(fs.existsSync(pdf.companionPngPath),true);
    assert.equal(pdf.toolbarExcluded,true,'the PDF staging page must exclude the injected floating toolbar');
    assert.equal(await containsRgb(page,fs.readFileSync(pdf.companionPngPath),[22,89,197]),false,
      'snapshot PDF companion PNG must exclude the floating toolbar buttons');
    assert.equal(await page.locator('#hd-assistant-root').evaluate(el=>getComputedStyle(el).visibility),'visible',
      'toolbar must reappear after PDF export');
    const after=await capturePage(page,args);
    assert.equal(after.actualWidth,1280);
    assert.equal(after.actualHeight,960);
    const vector=await vectorPdf(page,args,{fullPage:false});
    assert.equal(fs.readFileSync(vector.filePath).subarray(0,4).toString(),'%PDF',
      'vector PDF button must actually produce a PDF');
    const vectorFull=await vectorPdf(page,args,{fullPage:true});
    assert.equal(fs.readFileSync(vectorFull.filePath).subarray(0,4).toString(),'%PDF',
      'Print PDF (full-page button) must actually produce a PDF');
    // Reproduce reported user case: 2560×1305 @ ×4 = 53.4M pixels,
    // larger than the 45M safety ceiling. Must AUTO-DOWNGRADE, not fail.
    assert.equal(chooseCaptureDpr(2560,1305,4),3);
    await page.setViewportSize({width:2560,height:1305});
    await page.setContent(`<!doctype html><style>
      html,body{margin:0;padding:0;width:2560px;height:1305px;background:#edf1f5}
      .content{position:relative;box-sizing:border-box;width:2560px;height:1305px;
        border:3px solid #000; background:#eef3ff}
      .corner{position:absolute;right:2px;bottom:2px;background:#f00;color:#fff}
    </style><main class="content">Large monitor screenshot <span class="corner">edge</span></main>`);
    const bigArgs={...args,dpr:4,width:2560,height:1305};
    const large=await capturePage(page,bigArgs);
    assert.equal(large.effectiveDpr,2,'visible screen must use real Chrome 2x device pixel scale, not configured 4x');
    assert.equal(large.actualWidth,5120,'large monitor native screenshot must match actual browser pixels');
    assert.equal(large.actualHeight,2610,'large monitor native screenshot must match actual browser pixels');
    assert.ok(fs.statSync(large.filePath).size>1000,'PNG must be physically saved');
    const largePdf=await snapshotPdf(page,bigArgs);
    assert.equal(largePdf.effectiveDpr,2,'large screen snapshot PDF must share browser-native DPR');
    assert.equal(fs.readFileSync(largePdf.filePath).subarray(0,4).toString(),'%PDF',
      'large screen PDF must be valid instead of failing on a pixel limit');
    const fullLarge=await capturePage(page,bigArgs,{fullPage:true});
    assert.equal(fullLarge.effectiveDpr,3,'full-page PNG must adapt too');
    // Small selection follows current browser-native DPR, not a hard-coded quality multiplier.
    const largeSelection=await capturePage(page,bigArgs,{rect:{x:20,y:20,width:180,height:120}});
    assert.equal(largeSelection.effectiveDpr,2);
    assert.equal(largeSelection.actualWidth,360);
    assert.equal(largeSelection.actualHeight,240);
    // Chrome Ctrl+mouse-wheel browser zoom regression (not CSS transform/zoom).
    await page.setViewportSize({width:960,height:720});
    await page.setContent(`<!doctype html><style>
      html,body{margin:0;width:1700px;height:1800px;background:#fff}
      .fixed-flag{position:fixed;left:24px;top:30px;width:120px;height:100px;background:#ff0000}
      .another{position:fixed;left:240px;top:180px;width:100px;height:100px;background:#0000ff}
      .footer{position:absolute;left:150px;top:1400px;width:200px;height:150px;background:#00ff00}
    </style><div class="fixed-flag"></div><div class="another"></div><div class="footer"></div>`);
    const zoomArgs={...args,width:960,height:720,dpr:3};
    zoomArgs.initialBrowserDpr=await page.evaluate(()=>window.devicePixelRatio);
    await page.mouse.move(400,350);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0,-452);
    await page.keyboard.up('Control');
    await page.waitForTimeout(600);
    const currentBrowserDpr=await page.evaluate(()=>window.devicePixelRatio);
    const zoomObserved=Math.abs(currentBrowserDpr-zoomArgs.initialBrowserDpr)>0.025;
    console.log('Chrome Ctrl+wheel zoom: before='+zoomArgs.initialBrowserDpr+
      ', after='+currentBrowserDpr+', applied='+zoomObserved);
    if(!zoomObserved) {
      // Some headless Chrome builds ignore OS-level Ctrl+wheel events;
      // emulate a changed device ratio for the same coordinate/verification path.
      const client=await page.context().newCDPSession(page);
      await client.send('Emulation.setDeviceMetricsOverride',{
        width:960,height:720,deviceScaleFactor:1.5,mobile:false
      });
      await client.detach();
      await page.waitForTimeout(250);
    }
    await page.evaluate(()=>window.scrollTo(170,145));
    const zoomRect=await captureBuffer(page,zoomArgs,{rect:{x:10,y:10,width:160,height:140}});
    const zoomFactor=zoomRect.pixel.width/160;
    assert.deepEqual(await pixelAt(page,zoomRect.buffer,
      Math.round(55*zoomFactor),Math.round(55*zoomFactor)),[255,0,0,255],
      'Ctrl+wheel zoom + page scroll must not displace the selected red marker');
    const zoomViewport=await captureBuffer(page,zoomArgs);
    const currentScale=zoomViewport.pixel.width/zoomViewport.cssWidth;
    assert.deepEqual(await pixelAt(page,zoomViewport.buffer,
      Math.round(80*currentScale),Math.round(80*currentScale)),[255,0,0,255],
      'Ctrl+wheel zoom must keep the fixed red flag at correct screenshot coordinates');
    const zoomPdf=await snapshotPdf(page,zoomArgs,{rect:{x:10,y:10,width:160,height:140}});
    assert.equal(fs.readFileSync(zoomPdf.filePath).subarray(0,4).toString(),'%PDF');
    const zoomPdfImg=fs.readFileSync(zoomPdf.companionPngPath);
    assert.deepEqual(await pixelAt(page,zoomPdfImg,
      Math.round(55*(zoomRect.pixel.width/160)),
      Math.round(55*(zoomRect.pixel.width/160))),[255,0,0,255],
      'PDF companion PNG must remain aligned under Chrome zoom');
    console.log('Browser zoom regression passed: selected PNG, viewport PNG, and PDF while scrolled.');
    console.log('Browser E2E passed: continuous capture, PDF, viewport bounds, and adaptive DPR on 2560x1305');
  } finally {
    await ctx.close();
    fs.rmSync(work,{recursive:true,force:true});
  }
}
main().catch(err=>{console.error(err);process.exitCode=1});
