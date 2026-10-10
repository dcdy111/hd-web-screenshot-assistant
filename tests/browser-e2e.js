'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {capturePage,captureBuffer,snapshotPdf,overlayScript}=require('../hd-screenshot-assistant');

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
    assert.deepEqual([trimmedViewport.cssWidth,trimmedViewport.cssHeight],[538,398],
      'viewport capture must trim unused right and bottom margins when a bounded page surface exists');
    const trimmedRegion=await captureBuffer(page,args,{rect:{x:20,y:20,width:600,height:440}});
    assert.deepEqual([trimmedRegion.cssWidth,trimmedRegion.cssHeight],[518,378],
      'selected capture must preserve its top-left point and trim only the blank right and bottom edges');

    await page.setContent(`<!doctype html><style>
      html,body{margin:0;width:1800px;height:1400px;background:#fff}
      .fixed-shell{position:fixed;inset:0;background:#f6f7f9}
      .fixed-page{box-sizing:border-box;position:absolute;left:0;top:0;width:522px;height:382px;
        border:2px solid #334155;background:#eef2ff;padding:18px}
    </style><div class="fixed-shell"><main class="fixed-page"><h1>Fixed application shell</h1><p>The page card still determines the visible content boundary.</p></main></div>`);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForFunction(()=>window.scrollX===0&&window.scrollY===0);
    const fixedShell=await captureBuffer(page,args);
    assert.deepEqual([fixedShell.cssWidth,fixedShell.cssHeight],[538,398],
      'a fixed application shell must not prevent trimming its bounded page content');

    await page.setContent('<iframe id="content-frame"></iframe>');
    await page.locator('#content-frame').evaluate(frame=>{
      frame.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;border:0';
      frame.srcdoc='<!doctype html><style>html,body{margin:0;width:1800px;height:1400px;background:#fff}.page{box-sizing:border-box;position:absolute;left:0;top:0;width:522px;height:382px;border:2px solid #334155;background:#eef2ff;padding:18px}</style><main class="page"><h1>Embedded page content</h1><p>Measure the visible page inside the full-window frame.</p></main>';
    });
    await page.frameLocator('#content-frame').locator('.page').waitFor();
    const iframeContent=await captureBuffer(page,args);
    assert.deepEqual([iframeContent.cssWidth,iframeContent.cssHeight],[538,398],
      'a full-window iframe must be cropped to the embedded page content bounds');

    // Regression for the reported multi-monitor screenshot: the DOM's
    // nearly-transparent full-size shell reaches the viewport edge, but the
    // actual app panel ends much earlier, leaving a wide blank right/bottom.
    await page.setContent(\`<!doctype html><style>
      html,body{margin:0;width:640px;height:480px;background:#f4f7f9}
      .phantom{position:absolute;left:120px;top:0;width:518px;height:478px;
        border:1px solid rgba(0,0,0,.001);pointer-events:none}
      .app{box-sizing:border-box;width:500px;height:370px;
        background:#fff;border:2px solid #254269}
    </style><div class="phantom"></div><main class="app"><h1>Working dashboard</h1><p>Trim empty background, not the visible application.</p></main>\`);
    const noBlank=await captureBuffer(page,args);
    assert.ok(noBlank.cssWidth>=498 && noBlank.cssWidth<=532,
      'a barely visible full-size DOM shell must not keep the empty right margin');
    assert.ok(noBlank.cssHeight>=368 && noBlank.cssHeight<=402,
      'a barely visible full-size DOM shell must not keep the empty bottom margin');
    assert.ok(noBlank.pixel.width>=996&&noBlank.pixel.width<=1064,
      'trimmed screenshot must retain the expected high-resolution pixel scale');

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
    console.log('Browser E2E passed: viewport, selected region, repeat, reload, PDF and screenshot after PDF');
  } finally {
    await ctx.close();
    fs.rmSync(work,{recursive:true,force:true});
  }
}
main().catch(err=>{console.error(err);process.exitCode=1});
