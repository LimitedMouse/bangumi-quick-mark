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
