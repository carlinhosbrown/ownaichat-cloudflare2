import {ensure,ApiError} from './errors.js';
import {authorizationHeaders,validatePublicUrl} from './connections.js';

const MAX_IMAGE_BYTES=6*1024*1024;
const CHUNK_CHARS=240000;

async function limitedBytes(response,limit){
  ensure(response.body,'El proveedor no devolvió contenido.',502);
  const reader=response.body.getReader();const chunks=[];let size=0;
  try{
    while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit){await reader.cancel();throw new ApiError('La imagen o respuesta supera el tamaño admitido.',413);}chunks.push(next.value);}
  }finally{reader.releaseLock();}
  const output=new Uint8Array(size);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}return output;
}

function imageMime(bytes){
  if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
  throw new ApiError('El proveedor no devolvió una imagen PNG, JPEG o WebP válida.',502);
}

export async function requestImage(connection,key,model,prompt,settings){
  let endpoint,body,headers;
  if(connection.id==='gemini'){
    endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers={'x-goog-api-key':key};
    body={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseModalities:['TEXT','IMAGE']}};
  }else{
    endpoint=connection.custom?connection.baseUrl+'/images/generations':'https://api.openai.com/v1/images/generations';
    headers=authorizationHeaders(connection,key);
    body={model,prompt,n:1,size:settings.size,quality:settings.quality};
    if(connection.custom)body.response_format='b64_json';
  }
  let response;
  try{response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(180000)});}
  catch{throw new ApiError('No se pudo conectar al generador de imágenes. El servidor puede estar arrancando; comprueba su estado antes de repetir.',502);}
  ensure(response.ok,`El generador rechazó la solicitud (HTTP ${response.status}). Comprueba el modelo, los permisos y el saldo.`,502);
  let result;
  try{result=JSON.parse(new TextDecoder().decode(await limitedBytes(response,12*1024*1024)));}
  catch(error){if(error instanceof ApiError)throw error;throw new ApiError('El generador no devolvió JSON compatible.',502);}
  const parts=result.candidates?.[0]?.content?.parts||[];
  const inline=parts.find(part=>!part.thought&&(part.inlineData||part.inline_data));
  let encoded=connection.id==='gemini'?(inline?.inlineData?.data||inline?.inline_data?.data):result.data?.[0]?.b64_json;
  if(!encoded&&typeof result.data?.[0]?.url==='string'){
    const url=validatePublicUrl(result.data[0].url,{allowQuery:true});
    let downloaded;
    try{downloaded=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(30000)});}catch{throw new ApiError('No se pudo recuperar la imagen generada.',502);}
    ensure(downloaded.ok,'La URL de la imagen no está disponible o redirige a otro destino.',502);
    const bytes=await limitedBytes(downloaded,MAX_IMAGE_BYTES);
    imageMime(bytes);
    const strings=[];for(let offset=0;offset<bytes.length;offset+=24576)strings.push(String.fromCharCode(...bytes.subarray(offset,offset+24576)));
    encoded=btoa(strings.join(''));
  }
  ensure(typeof encoded==='string'&&encoded.length>16&&encoded.length<=Math.ceil(MAX_IMAGE_BYTES/3)*4,'No se recibió una imagen base64 o supera el máximo de 6 MiB.',502);
  ensure(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)&&encoded.length%4===0,'La imagen devuelta no tiene un formato base64 válido.',502);
  const mime=imageMime(Uint8Array.from(atob(encoded.slice(0,Math.min(48,encoded.length))),character=>character.charCodeAt(0)));
  const bytes=encoded.length*3/4-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);
  const text=connection.id==='gemini'?parts.filter(part=>!part.thought&&typeof part.text==='string').map(part=>part.text).join('\n').slice(0,16000):'Imagen generada.';
  return {encoded,mime,bytes,text:text||'Imagen generada.'};
}

export function imageStatements(env,imageId,messageId,chatId,image){
  const statements=[env.DB.prepare('INSERT INTO generated_images(id,message_id,chat_id,mime,bytes) VALUES(?,?,?,?,?)').bind(imageId,messageId,chatId,image.mime,image.bytes)];
  for(let position=0,offset=0;offset<image.encoded.length;position++,offset+=CHUNK_CHARS)statements.push(env.DB.prepare('INSERT INTO generated_image_chunks(image_id,position,data) VALUES(?,?,?)').bind(imageId,position,image.encoded.slice(offset,offset+CHUNK_CHARS)));
  return statements;
}

export async function imageResponse(env,imageId,download=false){
  const image=await env.DB.prepare('SELECT mime,bytes FROM generated_images WHERE id=?').bind(imageId).first();
  ensure(image,'Imagen no encontrada.',404);
  const {results}=await env.DB.prepare('SELECT data FROM generated_image_chunks WHERE image_id=? ORDER BY position').bind(imageId).all();
  ensure(results?.length,'Imagen no disponible.',404);
  const stream=new ReadableStream({start(controller){for(const chunk of results)controller.enqueue(Uint8Array.from(atob(chunk.data),character=>character.charCodeAt(0)));controller.close();}});
  const extension=image.mime==='image/jpeg'?'jpg':image.mime==='image/webp'?'webp':'png';
  return new Response(stream,{headers:{'content-type':image.mime,'content-length':String(image.bytes),'content-disposition':`${download?'attachment':'inline'}; filename="ownaichat-${imageId}.${extension}"`,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
}
