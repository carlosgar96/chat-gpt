'use strict';
const express=require('express'),multer=require('multer'),archiver=require('archiver');
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto'),{spawn,spawnSync}=require('node:child_process');
const app=express();app.disable('x-powered-by');
const root='/tmp/autoeditor';fs.mkdirSync(root,{recursive:true});
const inbox=path.join(root,'inbox');fs.mkdirSync(inbox,{recursive:true});
app.use((req,res,next)=>{const o=req.get('origin');if(o==='https://autoeditor-studio-iphone.onrender.com'||o==='http://localhost:3000'){res.set('Access-Control-Allow-Origin',o);res.set('Vary','Origin')}res.set('Access-Control-Allow-Methods','POST,GET,OPTIONS');res.set('Access-Control-Allow-Headers','Content-Type');if(req.method==='OPTIONS')return res.sendStatus(204);next()});
app.get('/health',(req,res)=>{const p=spawnSync('ffmpeg',['-version'],{encoding:'utf8',timeout:4000});res.status(p.status===0?200:503).json({ok:p.status===0,version:p.stdout?.split('\n')[0]||null})});
const uploader=multer({dest:inbox,limits:{fileSize:22*1024*1024,files:101,fields:4},fileFilter:(req,f,cb)=>{if(f.fieldname==='images'&&(/^image\//.test(f.mimetype)||/\.(png|webp|jpe?g|heic)$/i.test(f.originalname)))cb(null,true);else if(f.fieldname==='audio'&&(/^audio\//.test(f.mimetype)||/\.(mp3|m4a|wav|aac|ogg|mp4)$/i.test(f.originalname)))cb(null,true);else cb(new Error('Tipo de archivo no compatible'))}}).fields([{name:'images',maxCount:100},{name:'audio',maxCount:1}]);
const jobs=new Map(),queue=[];let busy=false;
const fmt=x=>Number(x).toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
const even=x=>Math.max(2,Math.round(x/2)*2);
const safeName=s=>(String(s||'clip').split(/[\\/]/).pop().replace(/\.[^.]+$/,'').trim().replace(/[<>:"/\\|?*]/g,'_').replace(/[. ]+$/,'').slice(0,90)||'clip');
function dimensions(r,q){const [a,b]=({'9:16':[9,16],'16:9':[16,9],'1:1':[1,1],'4:5':[4,5]})[r]||[9,16];const k=(q===1080?1080:720)/Math.min(a,b);return[even(a*k),even(b*k)]}
function runFFmpeg(args,job,timeout=600000){return new Promise((resolve,reject)=>{const p=spawn('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-threads','2',...args]);job.proc=p;let error='',done=false;const timer=setTimeout(()=>{p.kill('SIGKILL');fail(Error('El servidor tardó demasiado al procesar el video.'))},timeout);
function fail(e){if(done)return;done=true;clearTimeout(timer);job.proc=null;reject(e)}
p.stderr.on('data',b=>error=(error+b.toString()).slice(-2500));p.on('error',fail);p.on('close',c=>{if(done)return;done=true;clearTimeout(timer);job.proc=null;c===0?resolve():reject(Error(error||'FFmpeg error '+c))})})}
function filter(w,h,d,i,fit){
 const t='min(1,max(0,t/'+fmt(Math.max(.15,d))+'))';
 const x=i%2===0?t:'1-('+t+')';
 if(fit==='cover'){
  return '[0:v]scale='+even(w*1.08)+':'+even(h*1.08)+':force_original_aspect_ratio=increase,crop='+w+':'+h+':x=(iw-ow)*('+x+'):y=(ih-oh)/2,fps=30,format=yuv420p[v]';
 }
 const background=fit==='contain'?'gblur=sigma=0':'boxblur=12:1';
 return '[0:v]split=2[bi][fi];[bi]scale='+w+':'+h+':force_original_aspect_ratio=increase,crop='+w+':'+h+','+background+'[bg];[fi]scale='+(w-20)+':'+(h-20)+':force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=x='+"'"+'(W-w)*('+x+')'+"'"+':y='+"'"+'(H-h)/2'+"'"+':eval=frame:shortest=1,fps=30,format=yuv420p[v]';
}
async function visual(job,scene,i,d,out,w,h,fit){await runFFmpeg(['-loop','1','-framerate','30','-t',fmt(d),'-i',scene.path,'-filter_complex',filter(w,h,scene.duration,i,fit),'-map','[v]','-an','-t',fmt(d),'-c:v','libx264','-preset','veryfast','-crf','23','-r','30','-pix_fmt','yuv420p','-movflags','+faststart',out],job)}
async function narrated(job,vis,audio,start,d,out){if(!audio){await fsp.copyFile(vis,out);return}await runFFmpeg(['-ss',fmt(start),'-i',audio,'-i',vis,'-map','1:v:0','-map','0:a:0','-c:v','copy','-c:a','aac','-b:a','160k','-ar','48000','-af','aresample=async=1:first_pts=0,apad,atrim=duration='+fmt(d),'-t',fmt(d),'-movflags','+faststart',out],job)}
async function full(job,visuals,scenes,audio,settings,out){
 const overlap=settings.transition==='fade'&&scenes.length>1?Math.min(settings.transitionDuration,Math.min(...scenes.map(s=>s.duration))*.32):0;
 const total=scenes.reduce((a,s)=>a+s.duration,0),args=[];for(const v of visuals)args.push('-i',v);if(audio)args.push('-i',audio);
 let filters=[],mapped='';
 if(overlap){
  let last='0:v',offset=0;for(let i=1;i<visuals.length;i++){offset+=scenes[i-1].duration;const name='x'+i;filters.push('['+last+']['+i+':v]xfade=transition=fade:duration='+fmt(overlap)+':offset='+fmt(offset)+'['+name+']');last=name}mapped='['+last+']';
 }else{
  filters.push(visuals.map((v,i)=>'['+i+':v]').join('')+'concat=n='+visuals.length+':v=1:a=0[join]');mapped='[join]';
 }
 args.push('-filter_complex',filters.join(';'),'-map',mapped);
 if(audio)args.push('-map',visuals.length+':a:0');
 args.push('-c:v','libx264','-preset','veryfast','-crf','23','-r','30','-pix_fmt','yuv420p');
 if(audio)args.push('-c:a','aac','-b:a','160k','-af','aresample=async=1:first_pts=0,apad,atrim=duration='+fmt(total));else args.push('-an');
 args.push('-t',fmt(total),'-movflags','+faststart',out);
 await runFFmpeg(args,job,600000)
}
async function zipFile(items,filename,manifest){
 return new Promise((resolve,reject)=>{const archive=archiver('zip',{zlib:{level:1}}),stream=fs.createWriteStream(filename);archive.on('error',reject);stream.on('error',reject);stream.on('close',resolve);archive.pipe(stream);for(const x of items)archive.file(x.path,{name:x.name});archive.append(manifest,{name:'ORDEN_LINEA_DE_TIEMPO.txt'});archive.finalize().catch(reject)})
}
async function render(job){
 const imageFiles=job.uploads.images,audio=job.uploads.audio?.[0]?.path||null,set=job.settings,scenes=imageFiles.map((f,i)=>({path:f.path,name:set.scenes[i].name||f.originalname,duration:set.scenes[i].duration}));
 const [w,h]=dimensions(set.ratio,set.quality),total=scenes.reduce((a,s)=>a+s.duration,0);
 const overlap=set.mode==='full'&&set.transition==='fade'&&scenes.length>1?Math.min(set.transitionDuration,Math.min(...scenes.map(s=>s.duration))*.32):0;
 const temp=[],clips=[],used=new Set();let elapsed=0;
 job.status='processing';job.message='Renderizado FFmpeg iniciado';
 try{
  const manifest=['Nº | INICIO | DURACIÓN | ARCHIVO | ORIGINAL'];
  for(let i=0;i<scenes.length;i++){
   const sc=scenes[i],v=path.join(job.folder,'visual'+i+'.mp4');await visual(job,sc,i,sc.duration+(i<scenes.length-1?overlap:0),v,w,h,set.fit);temp.push(v);
   if(set.mode==='clips'){
    let name=safeName(sc.name)+'.mp4',serial=2;
    while(used.has(name.toLowerCase()))name=safeName(sc.name)+'_'+String(serial++).padStart(2,'0')+'.mp4';
    used.add(name.toLowerCase());
    const rendered=path.join(job.folder,'clip'+i+'.mp4');
    await narrated(job,v,audio,elapsed,sc.duration,rendered);
    clips.push({name,path:rendered});manifest.push((i+1)+' | '+fmt(elapsed)+' | '+fmt(sc.duration)+' | '+name+' | '+sc.name);
   }
   elapsed+=sc.duration;job.progress=Math.round((i+1)*75/scenes.length);job.message='Escena '+(i+1)+' de '+scenes.length;
  }
  if(set.mode==='full'){
   job.filename='AutoEditor_'+set.ratio.replace(':','x')+'.mp4';job.path=path.join(job.folder,job.filename);
   job.progress=78;job.message='Uniendo video y audio';await full(job,temp,scenes,audio,set,job.path);
  }else{
   job.filename='AutoEditor_clips.zip';job.path=path.join(job.folder,job.filename);
   job.progress=80;job.message='Preparando archivos MP4 en ZIP';await zipFile(clips,job.path,manifest.join('\n'));
  }
  const stat=await fsp.stat(job.path);if(stat.size<1000)throw Error('El resultado quedó vacío');
  job.status='ready';job.progress=100;job.message='Exportación terminada';job.size=stat.size;
 }catch(e){job.status='error';job.progress=0;job.message=(e.message||String(e)).slice(-400);console.error('Render failure:',job.message)}
 finally{
  for(const f of [...imageFiles,...(job.uploads.audio||[])])await fsp.rm(f.path,{force:true}).catch(()=>{});
  for(const entry of await fsp.readdir(job.folder).catch(()=>[]))if(entry!==job.filename)await fsp.rm(path.join(job.folder,entry),{recursive:true,force:true}).catch(()=>{});
  job.finished=Date.now()
 }
}
async function work(){if(busy)return;busy=true;while(queue.length){const j=queue.shift();if(j.status==='queued')await render(j)}busy=false}
app.post('/jobs',(req,res)=>{
 uploader(req,res,async err=>{
  const uploads=req.files||{},files=[...(uploads.images||[]),...(uploads.audio||[])];
  const reject=async(message,status=400)=>{for(const f of files)await fsp.rm(f.path,{force:true}).catch(()=>{});res.status(status).json({error:message})};
  if(err)return reject(err.message);
  if(queue.length>=3)return reject('Demasiados trabajos en cola',429);
  try{
   const set=JSON.parse(req.body.settings||'{}');set.scenes=set.scenes||[];
   if(!Array.isArray(set.scenes)||!set.scenes.length||set.scenes.length!==files.filter(x=>x.fieldname==='images').length||set.scenes.length>100)throw Error('Imágenes y escenas no coinciden');
   set.scenes=set.scenes.map(x=>({name:String(x.name||'foto'),duration:Number(x.duration)}));
   if(set.scenes.some(x=>!Number.isFinite(x.duration)||x.duration<.15||x.duration>120))throw Error('Duración incorrecta');
   if(set.scenes.reduce((a,s)=>a+s.duration,0)>360)throw Error('Máximo seis minutos por video');
   if(!['full','clips'].includes(set.mode))throw Error('Modo de exportación incorrecto');
   set.ratio=['9:16','16:9','1:1','4:5'].includes(set.ratio)?set.ratio:'9:16';set.quality=set.quality===1080?1080:720;
   set.fit=['blur','contain','cover'].includes(set.fit)?set.fit:'blur';set.transition=['fade','none'].includes(set.transition)?set.transition:'fade';set.transitionDuration=Math.max(.1,Math.min(1,Number(set.transitionDuration)||.35));
   const id=crypto.randomUUID(),folder=path.join(root,id);await fsp.mkdir(folder,{recursive:true});
   const job={id,folder,uploads,settings:set,status:'queued',progress:0,message:'En cola',created:Date.now(),filename:null,path:null,size:null};
   jobs.set(id,job);queue.push(job);res.status(202).json({id,status:'queued'});setImmediate(work);
  }catch(e){await reject(e.message)}
 })
});
app.get('/jobs/:id',(req,res)=>{const j=jobs.get(req.params.id);res.set('Cache-Control','no-store');if(!j)return res.status(404).json({error:'Trabajo no encontrado'});res.json({id:j.id,status:j.status,progress:j.progress,message:j.message,filename:j.status==='ready'?j.filename:null,size:j.status==='ready'?j.size:null})});
app.get('/jobs/:id/download',(req,res)=>{const j=jobs.get(req.params.id);if(!j||j.status!=='ready')return res.status(404).json({error:'El archivo todavía no está listo'});res.set('Cache-Control','no-store');res.download(j.path,j.filename)});
setInterval(async()=>{const now=Date.now();for(const [id,j] of jobs)if(now-j.created>45*60000&&!['processing','queued'].includes(j.status)){jobs.delete(id);await fsp.rm(j.folder,{recursive:true,force:true}).catch(()=>{})}},300000).unref();
app.listen(Number(process.env.PORT)||10000,'0.0.0.0',()=>console.log('AutoEditor FFmpeg server ready'));
