import {ApiError,ensure} from './errors.js';
import {MODEL_DEFAULTS,validModel} from '../public/models.js';

export const BUILTIN_PROVIDERS={
  deepseek:{name:'DeepSeek',endpoint:'https://api.deepseek.com/chat/completions'},
  openai:{name:'OpenAI',endpoint:'https://api.openai.com/v1/chat/completions'},
  gemini:{name:'Google Gemini',endpoint:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'},
  anthropic:{name:'Anthropic Claude',endpoint:'https://api.anthropic.com/v1/messages'}
};
export const isBuiltin=provider=>Object.hasOwn(BUILTIN_PROVIDERS,provider);
export const isCustom=provider=>typeof provider==='string'&&/^custom-[a-f0-9-]{36}$/.test(provider);

export function validatePublicUrl(value,{allowQuery=false}={}){
  let url;
  try{url=new URL(value);}catch{throw new ApiError('Introduce una URL HTTPS válida.');}
  ensure(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&(!url.search||allowQuery),'La URL debe usar HTTPS, sin usuario, contraseña, fragmentos ni parámetros en la URL base.');
  ensure(!url.port||url.port==='443','Usa HTTPS en el puerto público 443, por ejemplo el proxy HTTPS de RunPod.');
  const host=url.hostname.toLowerCase();
  ensure(host.length<=253&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)&&host.includes('.')&&!/^\d+(?:\.\d+)*$/.test(host),'Usa un nombre de dominio público, no una IP ni localhost.');
  ensure(!/(^|\.)(localhost|local|internal|lan|home|test|invalid|arpa)$/.test(host)&&host!=='metadata.google.internal'&&!host.endsWith('.workers.dev.local'),'No se permiten destinos locales o de metadatos.');
  return url;
}

export function validateConnection(data,existing=null){
  const name=typeof data.name==='string'?data.name.trim():'';
  ensure(name.length>=1&&name.length<=70,'El nombre debe tener entre 1 y 70 caracteres.');
  ensure(['openai','runpod-serverless','runpod-pod'].includes(data.kind),'Tipo de conexión desconocido.');
  const url=validatePublicUrl(data.baseUrl);
  url.pathname=url.pathname.replace(/\/+$/,'');
  ensure(!/\/(chat\/completions|models|images\/generations|run|runsync|status)(?:\/|$)/.test(url.pathname),'Introduce la URL base de la API, sin /chat/completions ni /run o /runsync.');
  if(data.kind==='runpod-serverless')ensure(url.hostname==='api.runpod.ai'&&/^\/v2\/[a-zA-Z0-9_-]+\/openai\/v1$/.test(url.pathname),'RunPod Serverless vLLM: https://api.runpod.ai/v2/ENDPOINT_ID/openai/v1');
  if(data.kind==='runpod-pod')ensure(/^[a-z0-9-]+-\d+\.proxy\.runpod\.net$/.test(url.hostname),'RunPod Pod: usa el proxy HTTPS público del puerto de tu servidor OpenAI compatible.');
  ensure(validModel(data.defaultModel),'Introduce el ID exacto del modelo de texto.');
  ensure(!data.imageModel||validModel(data.imageModel),'ID de modelo de imágenes no válido.');
  ensure(['bearer','none'].includes(data.authType),'Autenticación no válida.');
  ensure(['none','openai','deepseek','vllm'].includes(data.reasoningStyle),'Formato de razonamiento no válido.');
  const levels=data.effortLevels||[];
  ensure(Array.isArray(levels)&&levels.length<=7&&levels.every(level=>['minimal','low','medium','high','xhigh','max'].includes(level)),'Niveles de razonamiento no válidos.');
  const baseUrl=url.href.replace(/\/$/,'');
  const key=typeof data.key==='string'?data.key.trim():'';
  if(data.authType==='bearer'){
    if(key)ensure(key.length>=8&&key.length<=1024&&!/[\r\n]/.test(key),'Clave API no válida.');
    else ensure(existing?.ciphertext&&existing.auth_type==='bearer'&&existing.base_url===baseUrl,'Introduce la clave de esta conexión. Si cambias la URL, vuelve a introducirla para evitar enviarla a otro destino.');
  }
  return {name,kind:data.kind,baseUrl,defaultModel:data.defaultModel,imageModel:data.imageModel||'',authType:data.authType,reasoningStyle:data.reasoningStyle,effortLevels:data.reasoningStyle==='none'||data.reasoningStyle==='vllm'?[]:[...new Set(levels)],key};
}

export function publicConnection(row){
  return {id:row.id,name:row.name,kind:row.kind,baseUrl:row.base_url,defaultModel:row.default_model,imageModel:row.image_model,authType:row.auth_type,configured:row.auth_type==='none'||Boolean(row.ciphertext),reasoningStyle:row.reasoning_style,effortLevels:JSON.parse(row.effort_levels)};
}

export async function resolveConnection(env,provider){
  if(isBuiltin(provider))return {id:provider,...BUILTIN_PROVIDERS[provider],defaultModel:MODEL_DEFAULTS[provider],custom:false};
  ensure(isCustom(provider),'Proveedor desconocido.',404);
  const row=await env.DB.prepare('SELECT * FROM custom_providers WHERE id=?').bind(provider).first();
  ensure(row,'La conexión ya no está disponible. Elige otro proveedor o vuelve a configurarla.',404);
  validatePublicUrl(row.base_url);
  return {...publicConnection(row),endpoint:row.base_url+'/chat/completions',custom:true,ciphertext:row.ciphertext,iv:row.iv};
}

export const authorizationHeaders=(connection,key)=>connection.custom&&connection.authType==='none'?{}:connection.id==='anthropic'?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{Authorization:`Bearer ${key}`};
