const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../hplc_analyzer.html'),'utf8');
function definition(name){
  const start=html.indexOf(`function ${name}(`);
  assert(start>=0,`Missing ${name}`);
  const rest=html.slice(start),end=/^}/m.exec(rest);
  assert(end,`Missing closing brace for ${name}`);
  return rest.slice(0,end.index+1);
}
const helpers=['arrayMin','arrayMax'];
const fitFunctions=['hplcSmooth','hplcRollingBallBaseline','hplcEstimateNoise',
  'hplcProminence','hplcDetectPeaks','hplcGaussian','hplcEMG','hplcFitLM',
  'hplcFWHM','hplcAsym','hplcFitPeaksOnResiduals','hplcProcess'];
function engine(extra={}){
  const ctx=vm.createContext(extra);
  vm.runInContext([...helpers,...fitFunctions].map(definition).join('\n'),ctx);
  return ctx;
}
test('long arrays and typed arrays retain exact extrema without argument expansion',()=>{
  const ctx=engine(),values=Array.from({length:200000},(_,i)=>i-100000);
  assert.equal(ctx.arrayMin(values),-100000);assert.equal(ctx.arrayMax(values),99999);
  assert.equal(ctx.arrayMin(Float64Array.from(values)),-100000);
  assert.equal(ctx.arrayMax(Float64Array.from(values)),99999);
});
test('extrema retain empty, NaN, infinity and signed-zero semantics',()=>{
  const ctx=engine();
  for(const values of [[],[4,-2,10],[NaN,1],[Infinity,-Infinity],[-0,+0],[+0,-0]]){
    assert(Object.is(ctx.arrayMin(values),Math.min(...values)));
    assert(Object.is(ctx.arrayMax(values),Math.max(...values)));
  }
});
test('automatic baseline handles the reviewed 200000-sample size',()=>{
  const ctx=engine(),signal=new Array(200000).fill(5);signal[100000]=105;
  const baseline=ctx.hplcRollingBallBaseline(signal);
  assert.equal(baseline.length,signal.length);
  assert(baseline.every(v=>v===5));
});
test('width and asymmetry metrics handle a long peak with known geometry',()=>{
  const ctx=engine(),x=Array.from({length:200001},(_,i)=>i);
  const y=x.map(v=>1-Math.abs(v-100000)/100000);
  assert.equal(ctx.hplcFWHM(x,y),100000);
  assert.equal(ctx.hplcAsym(x,y,.1),1);
});
test('raw channel inspection computes statistics for 200000 samples',()=>{
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
  const ctx=engine({document:{querySelectorAll:()=>[],querySelector:()=>null,getElementById:node},
    CSS:{escape:s=>s},DTYPE_INFO:{10:{name:'float64'}}});
  vm.runInContext(definition('esc')+'\n'+definition('selectChannel'),ctx);
  ctx.selectChannel('/group/signal','group','signal',{
    values:Array.from({length:200000},(_,i)=>i),rawDataInfo:{dtype:10}});
  const info=node('tab-info').innerHTML;
  for(const value of [(0).toPrecision(7),(199999).toPrecision(7),(99999.5).toPrecision(8),
    Math.sqrt((200000**2-1)/12).toPrecision(6)])assert(info.includes(value),value);
  assert(node('tab-values').innerHTML.includes('of 200'));
});
test('Gaussian and EMG peak processing preserve expected fitted parameters',()=>{
  const ctx=engine(),time=Array.from({length:1001},(_,i)=>i*.01);
  for(const model of ['gauss','emg']){
    const signal=time.map(t=>model==='gauss'?ctx.hplcGaussian(t,5,5,.1):ctx.hplcEMG(t,2,5,.1,.08));
    const result=ctx.hplcProcess(time,signal,{baseline:'none',smoothWin:5,minHeightPct:2,minDist:.1,model});
    assert.equal(result.peaks.length,1,model);
    const peak=result.peaks[0];assert(peak.r2>.999,model);
    assert(Math.abs(peak.params.mu-5)<.001,model);
    assert(Math.abs(peak.sigma-.1)<.001,model);
    assert(Math.abs(peak.area-(model==='gauss'?5*.1*Math.sqrt(2*Math.PI):2))<.001,model);
  }
});
test('the generated worker includes extrema dependencies and completes a real fit',async()=>{
  let code;
  const ctx=engine({Blob,URL:{createObjectURL:blob=>{code=blob;return 'blob:test';}},Worker:class{}});
  vm.runInContext(definition('createHplcWorker'),ctx);ctx.createHplcWorker();
  const replies=[],worker=vm.createContext({self:{postMessage:message=>replies.push(message)}});
  vm.runInContext(await code.text(),worker);
  const time=Array.from({length:1001},(_,i)=>i*.01),signal=time.map(t=>3+ctx.hplcGaussian(t,5,5,.1));
  worker.self.onmessage({data:{id:7,time,signal,opts:{smoothWin:5,minHeightPct:2,minDist:.1,model:'gauss'}}});
  assert.equal(replies.length,1);assert.equal(replies[0].id,7);
  assert.equal(replies[0].success,true,replies[0].error);
  assert.equal(replies[0].result.peaks.length,1);
  assert(Math.abs(replies[0].result.peaks[0].tR-5)<.01);
});
test('all page scripts parse and no min/max call expands an array',()=>{
  for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);
  assert.doesNotMatch(html,/Math\.(?:min|max)\s*\(\s*\.\.\./);
});
