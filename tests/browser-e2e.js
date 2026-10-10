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
    assert.equal(await containsRgb(page,fs.readFileSync(pdf.companionPngPath),[22,89,197]),false,
      'snapshot PDF companion PNG must exclude the floating toolbar buttons');
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
