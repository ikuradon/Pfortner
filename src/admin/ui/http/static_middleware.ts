import { createStaticFileServer } from '../static_files.ts';

type FreshMiddlewareContext = {
  req: Request;
  next(): Promise<Response>;
};

export function createAdminStaticMiddleware(
  staticDir: string,
  adminPath: string,
): (ctx: FreshMiddlewareContext) => Promise<Response> {
  const staticFiles = createStaticFileServer(staticDir);
  return async (ctx) => {
    const url = new URL(ctx.req.url);
    const path = url.pathname;
    if (path.startsWith(`${adminPath}/static/`)) {
      const relativePath = path.slice(`${adminPath}/static`.length);
      return await staticFiles.serve(relativePath);
    }
    return await ctx.next();
  };
}
