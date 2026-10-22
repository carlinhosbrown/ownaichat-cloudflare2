export class ApiError extends Error {
  constructor(message,status=400,code){super(message);this.status=status;this.code=code;}
}
export const ensure=(condition,message,status=400,code)=>{if(!condition)throw new ApiError(message,status,code);};
