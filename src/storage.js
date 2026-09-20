const Storage = {
  get(key,fallback=null) {
    try {return typeof GM_getValue==='function'?GM_getValue(key,fallback):JSON.parse(localStorage.getItem(key)??JSON.stringify(fallback));} catch {return fallback;}
  },
  set(key,value) {if(typeof GM_setValue==='function') GM_setValue(key,value); else localStorage.setItem(key,JSON.stringify(value));},
  remove(key) {if(typeof GM_deleteValue==='function') GM_deleteValue(key); else localStorage.removeItem(key);},
  keys() {return typeof GM_listValues==='function'?GM_listValues():Object.keys(localStorage);},
  async lock(name,fn) {
    if(!navigator.locks) throw Error('浏览器不支持安全的多标签页保存，请使用新版 Chrome、Edge 或 Firefox');
    return navigator.locks.request('bqm:'+name,fn);
  }
};
function currentUser(doc=document) {
  const href=doc.querySelector('#dock a[href*="/user/"], .idBadgerNeue a[href*="/user/"]')?.getAttribute('href');
  return href?.match(/\/user\/([^/?#]+)/)?.[1] || null;
}
function migrate(user) {
  const marker='bqm:v2:migrated:'+user+':'+location.hostname;
  if(Storage.get(marker))return;
  let old=null, queue=[];
  try {old=JSON.parse(localStorage.getItem('bangumi-quick-mark-v1:'+user));queue=JSON.parse(localStorage.getItem('bangumi-quick-mark-v1:'+user+':queue'))||[];}catch{}
  const key='bqm:v2:position:'+user+':'+listKey(defaultList());
  if(positionValid(old)&&!Storage.get(key)) Storage.set(key,old);
  if(Array.isArray(queue)) for(const [i,j] of queue.entries()) if(/^\d+$/.test(j.id)&&Number.isInteger(j.score)&&j.score>=1&&j.score<=10) {
    const uid='legacy-'+i+'-'+j.id;
    Storage.set('bqm:v2:job:'+location.hostname+':'+user+':'+uid,{...j,uid,user,kind:'rate',status:'failed',order:i,created:Date.now(),error:'旧版本未确认任务，请点击重试核对。'});
  }
  Storage.set(marker,true);
}
function importData(data,user) {
  if(!data||data.schema!==2||data.user!==user||!Array.isArray(data.positions)||data.positions.length>1000)throw Error('备份版本或账号不匹配');
  const settings=validateSettings(data.settings);
  const positions=data.positions.map(entry=>{const config=listConfig(entry.list);if(!positionValid(entry.position))throw Error('进度格式无效');return {config,position:entry.position};});
  Storage.set('bqm:v2:settings',settings);
  for(const entry of positions)Storage.set('bqm:v2:position:'+user+':'+listKey(entry.config),entry.position);
  return settings;
}
