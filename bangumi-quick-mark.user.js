// ==UserScript==
// @name         Bangumi 快速补标
// @namespace    local.bangumi.quickmark
// @version      2.1.0
// @description  支持榜单和他人时间胶囊顺序补标、数字键评分、异步保存及进度恢复。
// @author       © 复旦沸点技术组-风吟雨
// @license      MIT
// @homepageURL  https://github.com/LimitedMouse/bangumi-quick-mark
// @supportURL   https://github.com/LimitedMouse/bangumi-quick-mark/issues
// @updateURL    https://raw.githubusercontent.com/LimitedMouse/bangumi-quick-mark/main/bangumi-quick-mark.user.js
// @downloadURL  https://raw.githubusercontent.com/LimitedMouse/bangumi-quick-mark/main/bangumi-quick-mark.user.js
// @match        https://bgm.tv/*
// @match        https://bangumi.tv/*
// @match        https://chii.in/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @run-at       document-end
// @noframes
// ==/UserScript==
/*
MIT License

Copyright (c) 2026 复旦沸点技术组-风吟雨

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
(() => {
"use strict";

// Module: config
const VERSION = '2.1.0';
const CREDIT = '© 复旦沸点技术组-风吟雨';
const TYPES = {anime:'动画',book:'书籍',game:'游戏',music:'音乐',real:'三次元'};
const SORTS = {rank:'排名',trends:'热度',collects:'收藏',date:'日期',title:'名称'};
const DONE = {anime:'看过',book:'读过',game:'玩过',music:'听过',real:'看过'};
const DEFAULTS = {
  score:7, ahead:8, behind:2, digits:true, wheel:'off', skipDone:false, confirmDelete:true,
  bindings:{back:'ArrowUp',skip:'ArrowDown,ArrowLeft',rate:'ArrowRight',remove:''},
  buttons:[{action:'skip',label:'跳过',visible:true},{action:'rate',label:'',visible:true},{action:'back',label:'上一部',visible:true},{action:'remove',label:'删除当前收藏',visible:true}]
};
const clone = value => JSON.parse(JSON.stringify(value));
function validateSettings(value) {
  const s={...clone(DEFAULTS),...value,bindings:{...DEFAULTS.bindings,...value?.bindings}};
  if(!Number.isInteger(s.score)||s.score<1||s.score>10) throw Error('默认评分应为 1–10');
  if(!Number.isInteger(s.ahead)||s.ahead<0||s.ahead>20||!Number.isInteger(s.behind)||s.behind<2||s.behind>10) throw Error('向前预加载为 0–20，保留前面为 2–10');
  if(!['off','alt','direct'].includes(s.wheel)) throw Error('滚轮设置无效');
  for(const name of ['digits','skipDone','confirmDelete']) if(typeof s[name]!=='boolean') throw Error('开关设置无效');
  const used=new Set();
  for(const action of ['back','skip','rate','remove']) {
    if(typeof s.bindings[action]!=='string') throw Error('快捷键格式无效');
    const keys=s.bindings[action].split(',').map(k=>k.trim()).filter(Boolean);
    for(const key of keys) {
      if(!/^(Arrow(Up|Down|Left|Right)|[a-zA-Z]|[0-9]|Delete|Backspace|Home|End|PageUp|PageDown)$/.test(key)) throw Error('键位仅支持方向键、单个字母、数字及导航键');
      const normalized=key.length===1?key.toLowerCase():key;
      if(used.has(normalized)||(s.digits&&/^\d$/.test(key))) throw Error('快捷键冲突：'+key);
      used.add(normalized);
    }
    s.bindings[action]=keys.map(k=>k.length===1?k.toLowerCase():k).join(',');
  }
  if(!Array.isArray(s.buttons)||s.buttons.length!==4||new Set(s.buttons.map(b=>b.action)).size!==4) throw Error('按钮配置无效');
  for(const b of s.buttons) if(!['back','skip','rate','remove'].includes(b.action)||typeof b.label!=='string'||b.label.length>30||typeof b.visible!=='boolean') throw Error('按钮配置无效');
  return s;
}
function listConfig(value) {
  const u=new URL(value,location.origin);
  if(!/^(bgm\.tv|bangumi\.tv|chii\.in)$/.test(u.hostname)) throw Error('只支持 Bangumi 列表地址');
  const timeline=u.pathname.match(/^\/user\/([A-Za-z0-9_-]+)\/timeline\/?$/);
  if(timeline){
    if(u.searchParams.has('page')&&!/^\d+$/.test(u.searchParams.get('page')))throw Error('时间胶囊页码无效');
    return {kind:'timeline',type:'anime',sort:'timeline',user:timeline[1],path:`/user/${timeline[1]}/timeline`,query:'type=subject'};
  }
  const match=u.pathname.match(/^\/(anime|book|game|music|real)\/browser(?:\/.*)?$/);
  if(!match) throw Error('请输入分类浏览页地址（例如 /anime/browser/?sort=rank）');
  const params=new URLSearchParams();
  for(const [key,val] of u.searchParams) if(['sort','orderby','year','month','type','platform','tag'].includes(key)) params.set(key,val);
  const sort=params.get('sort')||'rank';
  if(!SORTS[sort]) throw Error('不支持该排序');
  params.set('sort',sort); params.sort();
  return {kind:'browser',type:match[1],sort,path:u.pathname.replace(/\/$/,'')+'/',query:params.toString()};
}
const listKey = c => c.path+'?'+c.query;
const defaultList=()=>listConfig('/anime/browser/?sort=rank');
function positionValid(s) {return s&&Number.isInteger(s.page)&&s.page>0&&Number.isInteger(s.index)&&s.index>=0&&(s.id===null||/^\d+$/.test(s.id));}
const freshPosition=()=>({page:1,index:0,id:null});
const keyLabel=k=>({ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'}[k]||k);


// Module: storage
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


// Module: site
class Network {
  active=0; waiting=[];
  async request(path, options={}, priority=1) {
    await new Promise(resolve=>{this.waiting.push({resolve,priority});this.pump();});
    try {
      const url=new URL(path,location.origin);
      if(url.origin!==location.origin)throw Error('请求必须与当前站点同源');
      const response=await fetch(url,{...options,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(25000)});
      if(!response.ok)throw Error(`网站请求失败（${response.status}），请稍后重试`);
      if(new URL(response.url).pathname.startsWith('/login'))throw Error('登录已失效，请重新登录');
      return response;
    } finally {this.active--;this.pump();}
  }
  pump(){this.waiting.sort((a,b)=>a.priority-b.priority);while(this.active<4&&this.waiting.length){this.active++;this.waiting.shift().resolve();}}
}
class Site {
  network=new Network();
  subjects=new Map();
  constructor(user){this.user=user;}
  async doc(path,priority=1){return new DOMParser().parseFromString(await (await this.network.request(path,{},priority)).text(),'text/html');}
  subject(id,priority=1){
    if(this.subjects.has(id))return this.subjects.get(id);
    const request=this.doc('/subject/'+id,priority);this.subjects.set(id,request);
    request.catch(()=>{if(this.subjects.get(id)===request)this.subjects.delete(id);});
    while(this.subjects.size>80)this.subjects.delete(this.subjects.keys().next().value);
    return request;
  }
  form(doc,id){
    const form=[...doc.forms].find(f=>new URL(f.getAttribute('action')||'/',location.origin).pathname===`/subject/${id}/interest/update`);
    if(!form)throw Error('未找到收藏表单，请检查登录状态');return form;
  }
  selected(form,name){return form.querySelector(`[name="${name}"]:checked`)?.value||'';}
  async collection(id,priority=1){const form=this.form(await this.doc('/update/'+id,priority),id);return {form,interest:this.selected(form,'interest'),rating:this.selected(form,'rating')};}
  async verifyUser(){if(currentUser(await this.doc('/',0))!==this.user)throw Error('登录账号已变化，请刷新页面后再操作');}
  async save(job){
    await this.verifyUser();
    const original=await this.collection(job.id,0);
    if(job.kind==='remove') {
      if(!original.interest)return;
      const action=new URL(original.form.getAttribute('action'),location.origin), hash=action.searchParams.get('gh');
      if(!hash)throw Error('缺少删除收藏校验参数');
      await this.network.request(`/subject/${job.id}/remove?gh=${encodeURIComponent(hash)}`,{},0);
      if((await this.collection(job.id,0)).interest)throw Error('未确认删除成功');
    } else {
      if(original.interest==='2'&&original.rating===String(job.score))return;
      const body=new URLSearchParams(new FormData(original.form));body.set('interest','2');body.set('rating',String(job.score));body.set('update','保存');
      await this.network.request(original.form.getAttribute('action'),{method:'POST',body},0);
      const check=await this.collection(job.id,0);
      if(check.interest!=='2'||check.rating!==String(job.score))throw Error('未确认评分保存成功');
    }
  }
  async items(config,page,priority=1){
    const url=new URL(listKey(config),location.origin);url.searchParams.set('page',page);
    const doc=await this.doc(url,priority);
    if(config.kind==='timeline'){
      if(!doc.querySelector('#timelineTabs'))throw Error('时间胶囊暂时不可用，可能需要通过网站验证');
      const candidates=[...doc.querySelectorAll('li.tml_item')].map(li=>{
        const link=li.querySelector('a[data-subject-id]'),id=link?.getAttribute('data-subject-id');
        const score=Number(li.querySelector('.collectInfo .starlight')?.className.match(/\bstars(10|[1-9])\b/)?.[1]);
        if(!score||!/^\d+$/.test(id||''))return null;
        const card=li.querySelector('.card');
        return {id,title:card?.querySelector('.title a')?.firstChild?.textContent.trim()||link.textContent.trim(),original:card?.querySelector('.subtitle')?.textContent.trim()||'',cover:card?.querySelector('img')?.getAttribute('src')||'',info:`对方评分 ${score} 分 · ${card?.querySelector('.info')?.textContent.trim()||''}`,rank:0,type:'anime'};
      }).filter(Boolean);
      const unique=[...new Map(candidates.map(item=>[item.id,item])).values()];
      const checked=await Promise.all(unique.map(async item=>{
        const subject=await this.subject(item.id,priority);
        return subject.querySelector('#navMenuNeue > li > a.focus')?.getAttribute('href')==='/anime'?item:null;
      }));
      const result=checked.filter(Boolean);
      result.hasNext=[...doc.querySelectorAll('a[href*="page="]')].some(a=>a.textContent.includes('下一页'));
      return result;
    }
    const list=doc.querySelector('#browserItemList');
    if(!list)throw Error('列表暂时不可用，可能需要通过网站验证');
    const items=[...list.children].map(li=>{
      const a=li.querySelector('h3 a[href*="/subject/"]');if(!a)return null;
      return {id:a.getAttribute('href').match(/\/subject\/(\d+)/)?.[1],title:a.textContent.trim(),original:li.querySelector('h3 small')?.textContent||'',cover:li.querySelector('img')?.getAttribute('src')||'',info:li.querySelector('.info')?.textContent.trim()||'',rank:Number(li.querySelector('.rank')?.textContent.match(/\d+/)?.[0])||0,type:config.type};
    }).filter(i=>i?.id);
    return items;
  }
  async details(item,priority=1){
    const cover=new Image();if(item.cover)cover.src=item.cover;
    const [collection,summary]=await Promise.all([this.collection(item.id,priority),this.subject(item.id,priority).then(doc=>doc.querySelector('#subject_summary')?.textContent.trim()||'暂无简介').catch(()=> '简介暂时无法加载，可打开详情查看。')]);
    return {interest:collection.interest,rating:collection.rating,summary,cover};
  }
}
class Cache {
  pages=new Map();details=new Map();
  constructor(site){this.site=site;}
  get(map,key,factory,limit){
    if(map.has(key)){const v=map.get(key);map.delete(key);map.set(key,v);return v;}
    const p=factory();map.set(key,p);p.catch(()=>{if(map.get(key)===p)map.delete(key);});
    while(map.size>limit)map.delete(map.keys().next().value);return p;
  }
  list(c,p,priority=1){return this.get(this.pages,listKey(c)+':'+p,()=>this.site.items(c,p,priority),8);}
  detail(i,priority=1){return this.get(this.details,i.id,()=>this.site.details(i,priority),48);}
  update(job){
    const old=this.details.get(job.id);if(!old)return;
    const replacement=old.then(v=>({...v,interest:job.kind==='remove'?'':'2',rating:job.kind==='remove'?'':String(job.score)}));
    this.details.set(job.id,replacement);replacement.catch(()=>{if(this.details.get(job.id)===replacement)this.details.delete(job.id);});
  }
}


// Module: queue
class SaveQueue {
  running=false; completed=0; stopped=false;
  constructor(user,site,onChange,onSaved){
    this.user=user;this.site=site;this.onChange=onChange;this.onSaved=onSaved;
    this.prefix='bqm:v2:job:'+location.hostname+':'+user+':';
    this.timer=setInterval(()=>{this.onChange();void this.drain();},1800);
  }
  all(){return Storage.keys().filter(k=>k.startsWith(this.prefix)).map(k=>Storage.get(k)).filter(j=>j&&j.user===this.user&&['rate','remove'].includes(j.kind)).sort((a,b)=>a.order-b.order);}
  put(job){Storage.set(this.prefix+job.uid,job);}
  latest(id){return this.all().filter(j=>j.id===id).at(-1);}
  async enqueue(item,kind,score){
    if(!this.user)throw Error('请先登录 Bangumi');
    await Storage.lock('edit:'+this.user,()=>{
      const all=this.all();
      for(const j of all)if(j.id===item.id&&j.status!=='saving')Storage.remove(this.prefix+j.uid);
      const counterKey=this.prefix+'sequence';
      const order=Math.max(Date.now(),Number(Storage.get(counterKey,0))+1);Storage.set(counterKey,order);
      this.put({uid:crypto.randomUUID(),user:this.user,id:item.id,title:item.title,kind,score,status:'pending',order,created:Date.now(),error:''});
    });
    this.onChange();void this.drain();
  }
  async retry(uid){
    await Storage.lock('edit:'+this.user,()=>{
      const job=Storage.get(this.prefix+uid);if(!job)return;
      if(this.latest(job.id)?.uid!==uid){Storage.remove(this.prefix+uid);return;}
      job.status='pending';job.error='';this.put(job);
    });this.onChange();void this.drain();
  }
  async discard(uid){await Storage.lock('edit:'+this.user,()=>{const j=Storage.get(this.prefix+uid);if(j&&j.status!=='saving')Storage.remove(this.prefix+uid);});this.onChange();}
  async drain(){
    if(this.running||this.stopped||!this.user)return;
    this.running=true;
    try {
      await Storage.lock('writer:'+this.user,async()=>{
        // A saving marker left by a closed tab is safe to recover only after acquiring its writer lock.
        while(!this.stopped){
          let job;
          await Storage.lock('edit:'+this.user,()=>{
            const all=this.all();
            for(const old of all)if(all.some(j=>j.id===old.id&&j.order>old.order))Storage.remove(this.prefix+old.uid);
            job=this.all().find(j=>j.status==='pending'||j.status==='saving');
            if(job){job.status='saving';this.put(job);}
          });
          if(!job)break;
          this.onChange();
          try {
            await this.site.save(job);
            await Storage.lock('edit:'+this.user,()=>Storage.remove(this.prefix+job.uid));
            this.completed++;this.onSaved(job);
          }catch(error){
            await Storage.lock('edit:'+this.user,()=>{
              if(this.latest(job.id)?.uid!==job.uid)Storage.remove(this.prefix+job.uid);
              else{job.status='failed';job.error=error.message;this.put(job);}
            });
          }
          this.onChange();
        }
      });
    }catch(error){this.lastError=error.message;this.onChange();}
    finally{this.running=false;}
  }
  stop(){this.stopped=true;clearInterval(this.timer);}
}


// Module: ui
function createUI(){
 const host=document.createElement('div');host.id='bqm-launch';host.dataset.version=VERSION;
 const root=host.attachShadow({mode:'open'});document.body.append(host);
 root.innerHTML=`<style>
 :host{font:14px/1.65 system-ui,"Microsoft YaHei",sans-serif;color:#253248;position:relative;z-index:2147483646}*{box-sizing:border-box}[hidden]{display:none!important}button,input,select{font:inherit}button{cursor:pointer;border:1px solid #d9e0eb;border-radius:9px;background:white;padding:9px 14px;color:#253248}button:hover{background:#edf1f8}button:disabled{opacity:.5;cursor:wait}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #ba4380;outline-offset:2px}input,select{border:1px solid #ccd5e3;border-radius:6px;padding:6px;background:#fff;color:#253248}a{color:#b93e76}.muted{color:#697890;font-size:12px}.primary{background:#c84b86;color:#fff;border-color:#c84b86}.primary:hover{background:#ad376f}.danger{color:#b73546}#launch{position:fixed;right:22px;bottom:22px;background:#c84b86;color:#fff;box-shadow:0 5px 24px #0003}#shade{position:fixed;inset:0;background:#18202dbb;display:flex;align-items:center;justify-content:center;padding:20px}#panel{width:1020px;max-width:100%;max-height:95vh;overflow:auto;background:#fafbfe;border-radius:18px;padding:24px;box-shadow:0 20px 90px #0005}header,footer,.row,.scores,.actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap}header{justify-content:space-between;border-bottom:1px solid #e2e7ef;padding-bottom:12px}h2{font-size:24px;line-height:1.4;margin:8px 0}h3{margin:12px 0 8px;font-size:16px}#source{padding:12px 0;border-bottom:1px solid #e2e7ef}#source-url{flex:1;min-width:190px}#content{display:grid;grid-template-columns:220px 1fr;gap:24px;margin:20px 0}#cover{width:220px;max-height:320px;object-fit:contain;border-radius:10px;background:#edf0f5}#summary{white-space:pre-line;max-height:145px;overflow:auto;margin:12px 0;font-size:13px;overscroll-behavior:contain}#existing{font-weight:600;margin-top:10px}.scores{margin:12px 0;gap:7px}.scores button{min-width:46px}.actions button{flex:1}#status{min-height:25px;color:#a6386d;margin:10px 0}footer{margin-top:14px}#rank{width:95px}#failures{max-height:150px;overflow:auto}.failed{padding:6px 0;border-bottom:1px solid #e2e7ef}.failed span{display:block}.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.settings-grid label{display:flex;gap:8px;align-items:center;justify-content:space-between}.settings-grid input:not([type=checkbox]),.settings-grid select{width:155px}#settings{padding-top:10px}#settings-error{color:#b73546;min-height:22px}.button-setting{display:grid;grid-template-columns:80px 1fr 125px 70px;gap:8px;margin:8px 0}.button-setting input{min-width:0;width:100%}#import-file{max-width:240px}#queue-details{margin-top:8px}#queue-items{max-height:150px;overflow:auto}#hint{font-size:12px;color:#697890}#credit{margin-left:auto}#modal{position:absolute;inset:0;background:#172132a8;display:flex;align-items:center;justify-content:center}#modal-box{background:white;padding:24px;border-radius:12px;max-width:480px;margin:20px}#panel{position:relative}#source-title{width:100%}
 #content:has(#cover[hidden]){grid-template-columns:1fr}.button-setting input[type=checkbox]{width:auto}.button-setting label{display:flex;align-items:center;gap:5px}.settings-grid input[id^=bind-]{width:210px;max-width:60%}
 @media(max-width:650px){#content{grid-template-columns:1fr}#cover{width:130px;max-height:180px}#panel{padding:14px}#shade{padding:6px}.settings-grid{grid-template-columns:1fr}.button-setting{grid-template-columns:60px 1fr 100px 50px}}
 </style><button id="launch">▶ 快速补标</button><div id="shade" hidden><section id="panel" role="dialog" aria-modal="true" aria-label="Bangumi 快速补标">
 <header><div><strong>Bangumi 快速补标</strong><div id="hint"></div></div><div class="row"><button id="settings-open">设置</button><button id="close">暂停 / 关闭</button></div></header>
 <section id="main"><div id="source" class="row"><select id="category" aria-label="分类">${Object.entries(TYPES).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}<option value="comic">漫画</option></select><select id="sort" aria-label="排序">${Object.entries(SORTS).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select><button id="source-apply">切换列表</button><button id="source-current">使用当前网页列表</button><div class="row" style="width:100%"><input id="timeline-user" aria-label="他人用户名或时间胶囊地址" placeholder="他人用户名或时间胶囊地址" style="flex:1;min-width:190px"><button id="timeline-apply">浏览其评分动画</button></div><details style="width:100%"><summary>筛选列表地址</summary><div class="row"><input id="source-url" aria-label="列表地址" placeholder="粘贴 Bangumi 分类浏览页地址，保留筛选"><button id="source-url-apply">使用地址</button></div></details><span id="source-title" class="muted"></span></div>
 <div id="content"><img id="cover" alt="作品封面"><div><span id="position" class="muted"></span><h2 id="title">准备开始</h2><div id="original" class="muted"></div><div id="info"></div><div id="existing"></div><div id="summary"></div><a id="detail" target="_blank" rel="noopener">打开作品详情 ↗</a></div></div>
 <div id="score-label" class="muted"></div><div class="scores">${Array.from({length:10},(_,i)=>`<button data-score="${i+1}">${i+1}</button>`).join('')}</div><div id="actions" class="actions"></div>
 <div id="status" role="status" aria-live="polite"></div><div id="queue" class="muted" role="status"></div><div id="failures"></div><details id="queue-details"><summary>保存队列详情</summary><div id="queue-items"></div></details>
 <footer><button id="retry">重新加载</button><label><span id="jump-label">Rank</span> <input id="rank" type="number" min="1"></label><button id="jump">前往</button><span class="muted">位置自动记忆</span></footer></section>
 <section id="settings" hidden><h3>操作与预加载</h3><div class="settings-grid"><label>默认评分 <input id="setting-score" type="number" min="1" max="10"></label><label>后面预加载 <input id="setting-ahead" type="number" min="0" max="20"></label><label>前面保留 <input id="setting-behind" type="number" min="2" max="10"></label><label>滚轮操作 <select id="setting-wheel"><option value="off">关闭</option><option value="alt">Alt + 滚轮</option><option value="direct">直接滚轮</option></select></label><label>数字键评分（0 = 10）<input id="setting-digits" type="checkbox"></label><label>跳过已完成作品 <input id="setting-skipDone" type="checkbox"></label><label>删除前确认 <input id="setting-confirmDelete" type="checkbox"></label></div>
 <h3>快捷键</h3><p class="muted">点击输入框后按键可绑定；多个键用英文逗号分隔。清空表示禁用。输入框中不会触发评分。</p><div class="settings-grid">${[['back','上一部'],['skip','跳过下一部'],['rate','按默认分评分'],['remove','删除收藏']].map(([a,t])=>`<label>${t}<input id="bind-${a}" autocomplete="off"></label>`).join('')}</div>
 <h3>面板按钮</h3><p class="muted">自定义名称、动作和顺序，勾选决定是否显示。留空名称使用自动文案。</p><div id="button-settings"></div>
 <div id="settings-error" role="alert"></div><div class="row"><button id="settings-save" class="primary">保存设置</button><button id="settings-cancel">返回</button><button id="settings-reset">恢复默认配置</button></div>
 <h3>数据备份</h3><p class="muted">导出当前账号的各列表进度和操作设置。导入只接受同一账号备份，不自动提交任何收藏。</p><div class="row"><button id="export">导出设置与进度</button><input id="import-file" type="file" accept="application/json,.json"><button id="import">导入备份</button></div>
 <h3>关于</h3><p>Bangumi 快速补标 v${VERSION}<br>${CREDIT}</p><p class="muted">适用于所有 Bangumi 用户，无需本校身份。仅使用当前站点登录状态，无遥测、不上传个人数据。滚轮向下只跳过，不评分。关闭面板继续后台保存；关闭网页后未完成任务下次继续核对。</p></section>
 <footer><span id="credit" class="muted">${CREDIT}</span></footer>
 <div id="modal" hidden><div id="modal-box" role="alertdialog" aria-modal="true"><p id="modal-text"></p><div class="row"><button id="modal-yes" class="danger">确认删除</button><button id="modal-no">取消</button></div></div></section></div>`;
 return {host,root,$:id=>root.getElementById(id)};
}


// Module: app
async function boot(){
 if(window.top!==window.self||!/^(bgm\.tv|bangumi\.tv|chii\.in)$/.test(location.hostname))return;
 const previous=document.getElementById('bqm-launch');
 if(previous?.dataset.version===VERSION)return;
 if(previous){
   const pending=previous.shadowRoot?.getElementById('queue')?.textContent.match(/(\d+) 部待完成/);
   if(previous.shadowRoot?.getElementById('close')?.disabled||Number(pending?.[1])>0){setTimeout(boot,500);return;}
   previous.shadowRoot?.getElementById('close')?.click();previous.bqmDispose?.();previous.remove();
 }
 const user=currentUser();if(user)migrate(user);
 const {host,root,$}=createUI();
 let settings;try{settings=validateSettings(Storage.get('bqm:v2:settings',DEFAULTS));}catch{settings=clone(DEFAULTS);}
 let config;try{config=listConfig(Storage.get('bqm:v2:last:'+user,listKey(defaultList())));}catch{config=defaultList();}
 const positionKey=()=> 'bqm:v2:position:'+user+':'+listKey(config);
 const readPosition=()=>{const s=Storage.get(positionKey());return positionValid(s)?s:freshPosition();};
 let state=readPosition(),items=[],current=null,opened=false,busy=false,settingsOpen=false,prefetchGeneration=0,pageSize=24;
 const site=new Site(user),cache=new Cache(site);
 const setStatus=t=>{$('status').textContent=t;};
 const done=()=>DONE[config.type];
 const queue=new SaveQueue(user,site,renderQueue,job=>{cache.update(job);if(current?.id===job.id&&!queue.latest(job.id))$('existing').textContent=job.kind==='remove'?'当前：尚未收藏（已删除）':`当前：${DONE[current.type]} · ${job.score} 分（已保存）`;});
 host.bqmDispose=()=>queue.stop();
 function persist(){if(user)Storage.set(positionKey(),state);Storage.set('bqm:v2:last:'+user,listKey(config));}
 function showSource(){
   $('category').value=config.type==='book'&&config.path==='/book/browser/comic/'?'comic':config.type;
   $('sort').value=config.kind==='timeline'?'rank':config.sort;$('source-url').value=listKey(config);
   $('timeline-user').value=config.kind==='timeline'?config.user:'';
   $('source-title').textContent=config.kind==='timeline'?`@${config.user} · 时间胶囊 · 已评分动画（最近优先）`:`${TYPES[config.type]} · 按${SORTS[config.sort]}排序 · ${decodeURI(config.path)}`;
   $('jump-label').textContent=config.sort==='rank'?'Rank':'列表第 N 项';
   for(const id of ['jump-label','rank','jump'])$(id).hidden=config.kind==='timeline';
 }
 function applyControls(){
   const hints=[['back','上一部'],['skip','跳过'],['rate',`${done()} ${settings.score} 分`]].map(([a,t])=>settings.bindings[a].split(',').filter(Boolean).map(keyLabel).join(' / ')+' '+t);
   $('hint').textContent=hints.join(' · ')+(settings.digits?' · 1–9 评分 / 0 十分':'');
   $('score-label').textContent=`${done()}，给几分？选择后立即下一部，后台保存。`;
   root.querySelectorAll('[data-score]').forEach(b=>b.classList.toggle('primary',Number(b.dataset.score)===settings.score));
   $('actions').replaceChildren();
   for(const b of settings.buttons.filter(b=>b.visible)){
     const button=document.createElement('button');button.id={skip:'skip',rate:'seven',back:'back',remove:'remove'}[b.action];button.dataset.action=b.action;
     button.textContent=b.label||{skip:'没看过 / 跳过',rate:`${done()}，${settings.score} 分`,back:'上一部',remove:'删除当前收藏'}[b.action];
     if(b.action==='rate')button.className='primary';if(b.action==='remove')button.className='danger';
     button.onclick=()=>dispatch(b.action);$('actions').append(button);
   }
 }
 function renderQueue(){
   if(!queue)return;
   const all=queue.all(),failed=all.filter(j=>j.status==='failed'),pending=all.length-failed.length;
   $('queue').textContent=`后台保存：${pending} 部待完成 · ${queue.completed} 部已完成${failed.length?` · ${failed.length} 部需重试`:''}${queue.lastError?' · '+queue.lastError:''}`;
   $('failures').replaceChildren();$('queue-items').replaceChildren();
   for(const j of all){
     const row=document.createElement('div');row.className='failed';
     const label=document.createElement('span');label.textContent=`${j.title} · ${j.kind==='remove'?'删除收藏':j.score+' 分'} · ${{failed:'失败',pending:'等待',saving:'正在保存'}[j.status]}${j.error?'：'+j.error:''}`;row.append(label);
     if(j.status==='failed'){
       const retry=document.createElement('button');retry.textContent='重试';retry.onclick=()=>queue.retry(j.uid).catch(e=>setStatus(e.message));row.append(retry);
       const discard=document.createElement('button');discard.textContent='放弃此任务';discard.onclick=()=>queue.discard(j.uid).catch(e=>setStatus(e.message));row.append(discard);$('failures').append(row);
     }else $('queue-items').append(row);
   }
 }
 function lock(value){busy=value;root.querySelectorAll('#main button,#main input,#main select').forEach(e=>e.disabled=value);}
 async function run(fn){if(busy)return;lock(true);try{await fn();}catch(e){setStatus('操作停止：'+e.message);}finally{lock(false);}}
 async function prefetch(){
   const generation=++prefetchGeneration,c=clone(config),s={...state};
   const forward=items.slice(s.index+1,s.index+1+settings.ahead),backward=items.slice(Math.max(0,s.index-settings.behind),s.index);
   const active=()=>generation===prefetchGeneration&&opened&&!settingsOpen;
   try{
     for(let p=s.page+1,scanned=0;forward.length<settings.ahead&&active()&&scanned++<8;p++){
       const list=await cache.list(c,p,2);if(!list.length&&!list.hasNext)break;forward.push(...list.slice(0,settings.ahead-forward.length));
     }
     for(let p=s.page-1,scanned=0;backward.length<settings.behind&&p>0&&active()&&scanned++<8;p--){
       const list=await cache.list(c,p,2);backward.unshift(...list.slice(-(settings.behind-backward.length)));
     }
     const targets=[...backward.reverse(),...forward];let index=0;
     await Promise.all([0,1].map(async()=>{while(active()&&index<targets.length){try{await cache.detail(targets[index++],2);}catch{}}}));
   }catch{/* Optional preload failure is retried only on demand. */}
 }
 async function load({restore=false,skip=false}={}){
   ++prefetchGeneration;current=null;setStatus('正在加载作品…');
   items=await cache.list(config,state.page);
   if(config.kind==='timeline'){
     for(let scanned=0;!items.length&&items.hasNext&&scanned++<100;){state.page++;state.index=0;items=await cache.list(config,state.page);}
   }
   if(!items.length)throw Error('已到列表末尾或当前来源没有已评分动画，可返回上一部或切换列表');
   if(config.kind!=='timeline'){
     if(state.page===1)pageSize=items.length;
     else pageSize=(await cache.list(config,1)).length||24;
   }
   let relocated=false;
   if(restore&&state.id){
     let index=items.findIndex(i=>i.id===state.id);
     if(index<0){
       for(const p of [state.page-1,state.page+1].filter(p=>p>0)){
         const list=await cache.list(config,p);const found=list.findIndex(i=>i.id===state.id);
         if(found>=0){items=list;state.page=p;index=found;relocated=true;break;}
       }
     }
     if(index>=0)state.index=index;else{state.index=Math.min(state.index,items.length-1);relocated=true;}
   }
   if(state.index>=items.length){state={page:state.page+1,index:0,id:null};return load({skip});}
   let skipped=0;
   while(true){
     const item=items[state.index];
     const detail=await cache.detail(item);
     if(skip&&settings.skipDone&&detail.interest==='2'&&!queue.latest(item.id)&&skipped++<200){
       state.index++;state.id=null;
       if(state.index>=items.length){let page=state.page+1,list=await cache.list(config,page);while(config.kind==='timeline'&&!list.length&&list.hasNext){page++;list=await cache.list(config,page);}if(!list.length){state.index--;break;}state.page=page;state.index=0;items=list;}
       continue;
     }
     current=item;state.id=item.id;persist();
     $('title').textContent=item.title;$('original').textContent=item.original;$('info').textContent=item.info;
     if(item.cover){$('cover').src=item.cover;$('cover').hidden=false;}else{$('cover').removeAttribute('src');$('cover').hidden=true;}
     const ordinal=(state.page-1)*pageSize+state.index+1;
     $('position').textContent=config.kind==='timeline'?`时间胶囊第 ${state.page} 页 · 本页第 ${state.index+1} / ${items.length} 部`:`${item.rank?'Rank '+item.rank+' · ':''}列表第 ${ordinal} 项 · 第 ${state.page} 页 · ${state.index+1} / ${items.length}`;
     $('rank').value=config.sort==='rank'?(item.rank||''):ordinal;
     $('detail').href='/subject/'+item.id;$('summary').textContent=detail.summary;
     const labels={'1':'想'+{book:'读',game:'玩',music:'听'}[config.type],'2':done(),'3':'进行中','4':'搁置','5':'抛弃'};labels['1']=config.type==='anime'||config.type==='real'?'想看':labels['1'];
     $('existing').textContent=detail.interest?`当前：${labels[detail.interest]}${detail.rating?' · '+detail.rating+' 分':' · 未评分'}`:'当前：尚未收藏';
     const job=queue.latest(item.id);if(job)$('existing').textContent=`已选择：${job.kind==='remove'?'删除收藏':done()+' · '+job.score+' 分'}（${job.status==='failed'?'失败，需重试':'后台处理中'}）`;
     setStatus('准备好了。选择分数后立即下一部，后台保存。'+(relocated?' 榜单有变化，已按作品或邻近位置恢复。':''));
     void prefetch();return;
   }
   throw Error('已到列表末尾，后续没有未完成作品');
 }
 async function next(){
   const old={...state};state={page:state.page,index:state.index+1,id:null};
   try{await load({skip:true});}catch(e){state=old;await load();setStatus(e.message);}
 }
 async function back(){
   if(state.index>0)state={page:state.page,index:state.index-1,id:null};
   else if(state.page>1){let page=state.page-1,list=await cache.list(config,page);while(config.kind==='timeline'&&!list.length&&page>1){page--;list=await cache.list(config,page);}if(!list.length){setStatus('已经是第一部');return;}state={page,index:list.length-1,id:null};}
   else{setStatus('已经是第一部');return;}
   await load();
 }
 async function jump(target){
   if(!Number.isSafeInteger(target)||target<1)throw Error('请输入正整数');
   if(config.sort!=='rank'){
     const size=(await cache.list(config,1)).length;if(!size)throw Error('列表为空');
     const page=Math.floor((target-1)/size)+1,index=(target-1)%size,list=await cache.list(config,page);
     if(!list[index])throw Error('该序号超出列表范围');state={page,index,id:list[index].id};await load();return;
   }
   setStatus(`正在定位 Rank ${target}…`);
   const locate=async(list,page)=>{const index=list.findIndex(i=>i.rank===target);if(index<0)return false;state={page,index,id:list[index].id};await load();return true;};
   const first=await cache.list(config,1);if(await locate(first,1))return;
   let low=2,high=Math.max(2,Math.ceil(target/Math.max(1,first.length))),list=await cache.list(config,high);
   if(await locate(list,high))return;
   for(let n=0;list.length&&Math.max(...list.map(i=>i.rank))<target;n++){
     if(n>=16)throw Error('Rank 超出可定位范围');low=high+1;high*=2;list=await cache.list(config,high);if(await locate(list,high))return;
   }
   while(low<=high){const p=Math.floor((low+high)/2),candidates=await cache.list(config,p);if(await locate(candidates,p))return;if(!candidates.length||Math.max(...candidates.map(i=>i.rank))>=target)high=p-1;else low=p+1;}
   throw Error(`未找到 Rank ${target}，该排名可能不在当前筛选中`);
 }
 async function switchSource(c){
   persist();++prefetchGeneration;config=c;state=readPosition();items=[];current=null;showSource();applyControls();await load({restore:true});
 }
 let confirmResolve;
 function confirmRemove(item){
   if(!settings.confirmDelete)return Promise.resolve(true);
   $('modal-text').textContent=`删除「${item.title}」的收藏？网站会移除这条收藏及其评分、标签、短评。删除后停留当前作品。`;
   $('modal').hidden=false;$('modal-no').focus();return new Promise(resolve=>{confirmResolve=resolve;});
 }
 function resolveConfirm(value){$('modal').hidden=true;confirmResolve?.(value);confirmResolve=null;}
 $('modal-yes').onclick=()=>resolveConfirm(true);$('modal-no').onclick=()=>resolveConfirm(false);
 async function dispatch(action,score=settings.score){
   if(busy||!opened||settingsOpen||!current||!$('modal').hidden)return;
   if(action==='back')return run(back);if(action==='skip')return run(next);
   if(action==='rate')return run(async()=>{await queue.enqueue(current,'rate',score);await next();});
   if(action==='remove'){
     const item=current;
     if(await confirmRemove(item))await run(async()=>{await queue.enqueue(item,'remove',0);if(current?.id===item.id)$('existing').textContent='已选择：删除收藏（后台处理中）';setStatus('删除任务已加入队列，完成后会核对结果。');});
   }
 }
 function showSettings(draft=settings){
   settingsOpen=true;++prefetchGeneration;$('main').hidden=true;$('settings').hidden=false;$('settings-error').textContent='';
   for(const name of ['score','ahead','behind','wheel'])$('setting-'+name).value=draft[name];
   for(const name of ['digits','skipDone','confirmDelete'])$('setting-'+name).checked=draft[name];
   for(const name of ['back','skip','rate','remove'])$('bind-'+name).value=draft.bindings[name];
   $('button-settings').replaceChildren();
   for(const b of draft.buttons){
     const row=document.createElement('div');row.className='button-setting';
     row.innerHTML='<label><input type="checkbox" class="visible">显示</label><input class="label" placeholder="自动名称"><select class="action"><option value="skip">跳过</option><option value="rate">默认分评分</option><option value="back">上一部</option><option value="remove">删除收藏</option></select><button class="up">上移</button>';
     row.querySelector('.visible').checked=b.visible;row.querySelector('.label').value=b.label;row.querySelector('.action').value=b.action;
     row.querySelector('.up').onclick=()=>{if(row.previousElementSibling)row.parentNode.insertBefore(row,row.previousElementSibling);};$('button-settings').append(row);
   }
 }
 function closeSettings(){settingsOpen=false;$('settings').hidden=true;$('main').hidden=false;void prefetch();}
 $('settings-open').onclick=()=>{if(!busy&&!confirmResolve)showSettings();};$('settings-cancel').onclick=closeSettings;
 $('settings-save').onclick=()=>{
   try{
     const candidate={bindings:{},buttons:[]};for(const name of ['score','ahead','behind'])candidate[name]=Number($('setting-'+name).value);
     candidate.wheel=$('setting-wheel').value;for(const name of ['digits','skipDone','confirmDelete'])candidate[name]=$('setting-'+name).checked;
     for(const name of ['back','skip','rate','remove'])candidate.bindings[name]=$('bind-'+name).value;
     candidate.buttons=[...$('button-settings').children].map(r=>({action:r.querySelector('.action').value,label:r.querySelector('.label').value,visible:r.querySelector('.visible').checked}));
     settings=validateSettings(candidate);Storage.set('bqm:v2:settings',settings);applyControls();closeSettings();setStatus('设置已保存。');
   }catch(e){$('settings-error').textContent=e.message;}
 };
 $('settings-reset').onclick=()=>{showSettings(DEFAULTS);$('settings-error').textContent='已填入默认配置，点击保存设置生效。';};
 for(const name of ['back','skip','rate','remove'])$('bind-'+name).addEventListener('keydown',e=>{
   if(e.key==='Tab'||e.key==='Backspace'||e.key==='Delete'||e.key===',')return;
   if(e.ctrlKey||e.altKey||e.metaKey)return;e.preventDefault();e.currentTarget.value=e.key;
 });
 $('export').onclick=()=>{
   const prefix='bqm:v2:position:'+user+':';
   const data={schema:2,user,settings,positions:Storage.keys().filter(k=>k.startsWith(prefix)).map(k=>({list:k.slice(prefix.length),position:Storage.get(k)}))};
   const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='bangumi-quick-mark-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 $('import').onclick=async()=>{
   try{const file=$('import-file').files[0];if(!file||file.size>2_000_000)throw Error('请选择不超过 2 MB 的 JSON 备份');if(queue.all().some(j=>j.status!=='failed'))throw Error('请等待后台保存完成后导入');settings=importData(JSON.parse(await file.text()),user);state=readPosition();applyControls();showSettings();$('settings-error').textContent='已导入，返回后点击重新加载恢复位置。';}catch(e){$('settings-error').textContent=e.message;}
 };
 $('launch').onclick=()=>{opened=true;$('shade').hidden=false;if(!user){setStatus('请先登录 Bangumi，再刷新页面打开工具。');return;}run(()=>load({restore:true}));void queue.drain();};
 $('close').onclick=()=>{if(confirmResolve)resolveConfirm(false);opened=false;++prefetchGeneration;$('shade').hidden=true;};
 root.querySelectorAll('[data-score]').forEach(b=>b.onclick=()=>dispatch('rate',Number(b.dataset.score)));
 $('retry').onclick=()=>run(async()=>{cache.details.delete(current?.id||state.id);await load({restore:true});});
 $('jump').onclick=()=>run(()=>jump(Number($('rank').value)));
 $('rank').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(!busy)$('jump').click();}});
 $('source-apply').onclick=()=>run(()=>switchSource(listConfig($('category').value==='comic'?`/book/browser/comic?sort=${$('sort').value}`:`/${$('category').value}/browser/?sort=${$('sort').value}`)));
 $('source-current').onclick=()=>run(()=>switchSource(listConfig(location.href)));
 $('source-url-apply').onclick=()=>run(()=>switchSource(listConfig($('source-url').value)));
 $('timeline-apply').onclick=()=>run(()=>{
   const input=$('timeline-user').value.trim();
   if(!input)throw Error('请输入他人的用户名或时间胶囊地址');
   const url=/^https?:\/\//i.test(input)?input:`/user/${encodeURIComponent(input)}/timeline`;
   const source=listConfig(url);if(source.kind!=='timeline')throw Error('请输入时间胶囊地址');
   return switchSource(source);
 });
 const controller=new AbortController();
 document.addEventListener('keydown',e=>{
   if(!opened||e.isComposing)return;
   if(e.key==='Escape'){if(confirmResolve)resolveConfirm(false);else if(settingsOpen)closeSettings();else $('close').click();return;}
   const target=e.composedPath()[0];if(settingsOpen||confirmResolve||target?.matches?.('input,textarea,select')||target?.isContentEditable||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
   const key=e.key.length===1?e.key.toLowerCase():e.key;
   const action=Object.keys(settings.bindings).find(a=>settings.bindings[a].split(',').includes(key));
   const digit=settings.digits&&(/^[0-9]$/.test(e.key)||/^Numpad[0-9]$/.test(e.code))?Number(e.code.startsWith('Numpad')?e.code.slice(-1):e.key):null;
   if(!action&&digit===null)return;e.preventDefault();e.stopImmediatePropagation();if(e.repeat||busy)return;
   if(digit!==null)void dispatch('rate',digit||10);else void dispatch(action);
 },{capture:true,signal:controller.signal});
 let wheelTotal=0,wheelTime=0,wheelAction=0;
 $('panel').addEventListener('wheel',e=>{
   if(!opened||settingsOpen||confirmResolve||settings.wheel==='off'||(settings.wheel==='alt'&&!e.altKey)||e.ctrlKey||e.metaKey)return;
   const target=e.composedPath()[0];if(target.closest?.('#summary,#failures,#queue-items,input,select,textarea'))return;
   if(Math.abs(e.deltaX)>Math.abs(e.deltaY))return;e.preventDefault();
   const now=performance.now(),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?400:1),gap=now-wheelTime;
   if(gap>180||Math.sign(delta)!==Math.sign(wheelTotal))wheelTotal=0;
   wheelTime=now;wheelTotal+=delta;
   if(busy||now-wheelAction<650||(gap<120&&wheelAction&&now-wheelAction<1100)||Math.abs(wheelTotal)<70)return;
   wheelAction=now;wheelTotal=0;void dispatch(delta>0?'skip':'back');
 },{passive:false,signal:controller.signal});
 const originalDispose=host.bqmDispose;host.bqmDispose=()=>{originalDispose();controller.abort();};
 showSource();applyControls();renderQueue();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void boot(),{once:true});else void boot();

})();
