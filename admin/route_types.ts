import type { VNode } from 'preact';

export type AdminRouteContext = {
  req: Request;
  params: Record<string, string>;
  render: (vnode: VNode<any>, init?: ResponseInit) => Promise<Response>;
};

export type AdminRouteHandler = (ctx: AdminRouteContext) => Response | Promise<Response>;

export type AdminRouteApp = {
  get(path: string, handler: AdminRouteHandler): void;
  post(path: string, handler: AdminRouteHandler): void;
  delete(path: string, handler: AdminRouteHandler): void;
};
