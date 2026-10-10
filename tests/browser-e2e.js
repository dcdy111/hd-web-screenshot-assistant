'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {capturePage,snapshotPdf,overlayScript}=require('../hd-screenshot-assistant');

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
    const args={width:640,height:480,dpr:2,outDir};
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
    const one=await capturePage(page,args);
    assert.equal(one.actualWidth,1280);
    assert.equal(one.actualHeight,960);
    const crop=await capturePage(page,args,{rect:{x:100,y:50,width:280,height:200}});
    assert.equal(crop.actualWidth,560);
    assert.equal(crop.actualHeight,400);
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