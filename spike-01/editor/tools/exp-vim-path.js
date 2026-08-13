import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:false,
  args:['--window-size=1300,900','--window-position=60,60'], defaultViewport:null})
const p = (await b.pages())[0]
await p.goto('http://localhost:8321/', {waitUntil:'networkidle2'})
await p.waitForFunction('window.spikeSetFeature')
await p.evaluate(()=>document.getElementById('hud').classList.add('mini'))

await p.evaluate(()=>{
  window.probe = {keydownPrevented:0, beforeinput:0, beforeinputPrevented:0, keys:0, transactions:0, userEventInput:0}
  const c = document.querySelector('.cm-content')
  c.addEventListener('keydown', e=>{ window.probe.keys++; queueMicrotask(()=>{ if(e.defaultPrevented) window.probe.keydownPrevented++ }) }, true)
  c.addEventListener('beforeinput', e=>{ window.probe.beforeinput++; queueMicrotask(()=>{ if(e.defaultPrevented) window.probe.beforeinputPrevented++ }) }, true)
})

async function trial(vimOn){
  await p.evaluate(v=>window.spikeSetFeature('vim', v), vimOn)
  await p.evaluate(k=>window.spikeGoto(k), 'short')
  await new Promise(r=>setTimeout(r,400))
  await p.focus('.cm-content')
  if (vimOn) await p.keyboard.press('i')
  await p.evaluate(()=>{ for(const k in window.probe) window.probe[k]=0 })
  for (const ch of 'hello there friend') await p.keyboard.type(ch,{delay:70})
  await p.keyboard.press('Escape')
  return p.evaluate(()=>({...window.probe}))
}
console.log('vim OFF:', JSON.stringify(await trial(false)))
console.log('vim ON :', JSON.stringify(await trial(true)))
await b.close()
