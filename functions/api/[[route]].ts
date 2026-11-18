import app from '../../src/server/app';
import type{Env}from'../../src/server/db';
export const onRequest=(context:{request:Request;env:Env})=>app.fetch(context.request,context.env);
