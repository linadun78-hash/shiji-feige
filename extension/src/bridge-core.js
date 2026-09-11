(function(root) {
  function create({check, launch}) {
    let pending;
    async function start() {
      try {return await check();}
      catch(error) {if(error.message==='WRONG_SERVICE')throw error;}
      let result;
      try {result=await launch();} catch {throw Error('NATIVE_UNAVAILABLE');}
      if (!result?.ok) {
        const known=['PORT_OCCUPIED','START_TIMEOUT','START_FAILED'];
        throw Error(known.includes(result?.error)?result.error:'START_FAILED');
      }
      try {return await check();} catch {throw Error('START_FAILED');}
    }
    return {ensure() {
      if(!pending)pending=start().finally(()=>{pending=undefined;});
      return pending;
    }};
  }
  const api={create};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FeigeBridge=api;
})(globalThis);
