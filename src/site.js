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
  constructor(user){this.user=user;}
  async doc(path,priority=1){return new DOMParser().parseFromString(await (await this.network.request(path,{},priority)).text(),'text/html');}
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
    const [collection,summary]=await Promise.all([this.collection(item.id,priority),this.doc('/subject/'+item.id,priority).then(doc=>doc.querySelector('#subject_summary')?.textContent.trim()||'暂无简介').catch(()=> '简介暂时无法加载，可打开详情查看。')]);
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
