export const EFFORT_LABELS={auto:'Automático',minimal:'Mínimo',low:'Bajo',medium:'Medio',high:'Alto',xhigh:'Muy alto',max:'Máximo'};
export const DEFAULT_GENERATION={mode:'auto',effort:'auto',quality:'auto',size:'1024x1024'};

export function modelCapabilities(provider,model,connection=null){
  const capabilities={kind:'chat',levels:[],canDirect:false,reasoningStyle:'none',qualities:['auto','low','medium','high'],sizes:['1024x1024','1536x1024','1024x1536']};
  if(connection?.custom||provider.startsWith('custom-')){
    if(connection?.imageModel===model)capabilities.kind='image';
    capabilities.reasoningStyle=connection?.reasoningStyle||'none';
    capabilities.levels=connection?.effortLevels||[];
    capabilities.canDirect=capabilities.reasoningStyle!=='none';
    if(capabilities.reasoningStyle==='vllm')capabilities.levels=['auto'];
    return capabilities;
  }
  if(provider==='openai'&&/^(gpt-image-|chatgpt-image-)/.test(model)){
    capabilities.kind='image';
    if(/^gpt-image-2\.5-/.test(model))capabilities.qualities.push('xhigh','max');
    return capabilities;
  }
  if(provider==='gemini'&&/^gemini-.*image/.test(model)){capabilities.kind='image';capabilities.qualities=['auto'];capabilities.sizes=['auto'];return capabilities;}
  if(provider==='deepseek'&&/^deepseek-(flash|v4-pro|v4-flash)(?:-|$)/.test(model)){capabilities.levels=['low','high','max'];capabilities.reasoningStyle='deepseek';capabilities.canDirect=true;}
  if(provider==='openai'){
    const base=model.startsWith('ft:')?model.split(':')[1]:model;
    if(/^gpt-5(?:-|$)/.test(base)){capabilities.levels=['minimal','low','medium','high'];capabilities.canDirect=false;}
    else if(/^gpt-5\.1(?:-|$)/.test(base)){capabilities.levels=['low','medium','high'];capabilities.canDirect=true;}
    else if(/^gpt-5\.[2-5](?:-|$)/.test(base)){capabilities.levels=['low','medium','high','xhigh'];capabilities.canDirect=true;}
    else if(/^gpt-5\.6(?:-|$)|^gpt-6(?:\.1)?-(astra|sol|luna)(?:-|$)/.test(base)){capabilities.levels=['low','medium','high','xhigh','max'];capabilities.canDirect=!/^gpt-6(?:\.1)?-(astra|sol)/.test(base)||/^gpt-6-sol/.test(base);}
    else if(/^o[134](?:-|$)/.test(base)){capabilities.levels=['low','medium','high'];capabilities.canDirect=false;}
    else if(/^gpt-4(?:[.-]|$)/.test(base))capabilities.canDirect=true;
    if(capabilities.levels.length)capabilities.reasoningStyle='openai';
  }
  if(provider==='gemini'&&/^gemini-(2\.5|[34])/.test(model)){
    capabilities.reasoningStyle='openai';capabilities.levels=/^gemini-3.*pro/.test(model)?['low','high']:['low','medium','high'];
    capabilities.canDirect=/^gemini-2\.5-.*flash/.test(model);
  }
  const legacyClaude=/^claude-(sonnet|opus|haiku)-4(?:[.-][0-5])?(?:-\d{8})?$/.test(model);
  const adaptiveClaude=/^claude-(sonnet|opus)-4[.-][6-8](?:-|$)|^claude-(sonnet|opus|haiku)-5(?:[.-][15])?(?:-|$)|^claude-(fable|mythos)-(5(?:[.-]1)?|preview)(?:-|$)/.test(model);
  if(provider==='anthropic'&&(legacyClaude||adaptiveClaude)){
    capabilities.levels=['low','medium','high'];
    capabilities.reasoningStyle=legacyClaude?'anthropic-budget':'anthropic-adaptive';
    capabilities.canDirect=legacyClaude||/^claude-(sonnet|opus)-4/.test(model)||/^claude-(sonnet|opus)-5(?:-\d{8})?$|^claude-haiku-5[.-]5(?:-|$)/.test(model);
    if(adaptiveClaude){if(!/^claude-(sonnet|opus)-4[.-]6(?:-|$)|^claude-mythos-preview/.test(model))capabilities.levels.push('xhigh');capabilities.levels.push('max');}
  }
  return capabilities;
}

export function generationParameters(provider,model,settings={},connection=null){
  const selected=Object.fromEntries(Object.entries(DEFAULT_GENERATION).map(([name,value])=>[name,settings[name]??value]));
  if(!Object.hasOwn(EFFORT_LABELS,selected.effort))throw new Error('Nivel de razonamiento no válido.');
  const capabilities=modelCapabilities(provider,model,connection);
  if(!['auto','direct','reasoning','image'].includes(selected.mode))throw new Error('Modo no válido.');
  if(selected.mode==='image'){
    if(capabilities.kind!=='image')throw new Error('Elige un modelo de generación de imágenes para usar este modo.');
    if(!capabilities.qualities.includes(selected.quality)||!capabilities.sizes.includes(selected.size))throw new Error('Calidad o tamaño de imagen no compatible.');
    return {selected,extra:{}};
  }
  if(capabilities.kind==='image')throw new Error('Este modelo solo se puede utilizar en modo imagen.');
  if(selected.mode==='auto')return {selected,extra:{}};
  if(selected.mode==='direct'){
    if(!capabilities.canDirect)throw new Error('Este modelo no permite desactivar el razonamiento. Usa automático o razonamiento.');
    if(capabilities.reasoningStyle==='deepseek')return {selected,extra:{thinking:{type:'disabled'}}};
    if(capabilities.reasoningStyle==='openai')return {selected,extra:{reasoning_effort:'none'}};
    if(capabilities.reasoningStyle==='vllm')return {selected,extra:{chat_template_kwargs:{enable_thinking:false}}};
    if(capabilities.reasoningStyle.startsWith('anthropic'))return {selected,extra:{thinking:{type:'disabled'}}};
    return {selected,extra:{}};
  }
  if(!capabilities.levels.length)throw new Error('Este modelo o conexión no tiene configurado un modo de razonamiento compatible.');
  if(selected.effort!=='auto'&&!capabilities.levels.includes(selected.effort))throw new Error('El nivel de razonamiento elegido no es compatible con este modelo.');
  const level=selected.effort==='auto'?(capabilities.levels.includes('medium')?'medium':capabilities.levels.includes('high')?'high':capabilities.levels[0]):selected.effort;
  if(capabilities.reasoningStyle==='deepseek')return {selected,extra:{thinking:{type:'enabled'},reasoning_effort:level}};
  if(capabilities.reasoningStyle==='openai')return {selected,extra:{reasoning_effort:level}};
  if(capabilities.reasoningStyle==='vllm')return {selected,extra:{chat_template_kwargs:{enable_thinking:true}}};
  if(capabilities.reasoningStyle==='anthropic-budget'){
    const budget={low:1024,medium:4096,high:8192}[level];
    return {selected,extra:{thinking:{type:'enabled',budget_tokens:budget},max_tokens:budget+4096}};
  }
  return {selected,extra:{thinking:{type:'adaptive'},output_config:{effort:level},max_tokens:16000}};
}
