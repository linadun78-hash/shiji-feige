// Rasterize the same licensed Lucide Bird used by the panel. No remote assets.
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  try {
    const page=await browser.newPage({deviceScaleFactor:1});
    await page.setContent('<style>body{margin:0;background:transparent}#icon{background:#9e3029;width:100%;height:100%;border-radius:18%;display:flex;align-items:center;justify-content:center}svg{width:76%;height:76%;stroke:#fffaf5;stroke-width:1.8}</style><div id="icon"></div>');
    await page.addScriptTag({path:path.join(root,'preview/vendor/lucide.min.js')});
    await page.evaluate(()=>document.querySelector('#icon').append(lucide.createElement(lucide.icons.Bird)));
    fs.mkdirSync(path.join(root,'extension/icons'),{recursive:true});
    const data=await page.evaluate(async()=>{
      const svg=document.querySelector('svg');
      svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
      svg.setAttribute('stroke','#fffaf5');svg.setAttribute('stroke-width','1.8');
      const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(new XMLSerializer().serializeToString(svg));
      await img.decode();
      return [16,32,48,128].map(size=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#9e3029';ctx.beginPath();ctx.roundRect(0,0,size,size,size*.18);ctx.fill();
        ctx.drawImage(img,size*.12,size*.12,size*.76,size*.76);
        return {size,png:canvas.toDataURL('image/png').split(',')[1]};
      });
    });
    for(const item of data)fs.writeFileSync(path.join(root,`extension/icons/${item.size}.png`),Buffer.from(item.png,'base64'));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
