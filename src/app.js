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
