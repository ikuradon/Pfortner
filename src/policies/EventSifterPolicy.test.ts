import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.18';
import { eventSifterPolicy } from './EventSifterPolicy.ts';

const connectionInfo = {
  connectionId: 'test-id',
  connectionIpAddr: '127.0.0.1',
  clientAuthorized: false,
  clientPubkey: '',
};

const makeEvent = (overrides = {}) => ({
  id: 'event-id',
  pubkey: 'abc',
  kind: 1,
  created_at: 0,
  tags: [],
  content: '',
  sig: '',
  ...overrides,
});

Deno.test('eventSifterPolicy passes non-EVENT messages through', async () => {
  const message = ['NOTICE', 'hello'];
  const result = await eventSifterPolicy(message, connectionInfo, []);
  assertEquals(result.action, 'next');
  assertEquals(result.message, message);
});

Deno.test('eventSifterPolicy rejects client EVENT when ES policy rejects', async () => {
  const event = makeEvent();
  const message = ['EVENT', event];
  const rejectAll = () => ({ id: event.id, action: 'reject' as const, msg: 'blocked' });

  const result = await eventSifterPolicy(message, connectionInfo, [rejectAll]);
  assertEquals(result.action, 'reject');
  assertEquals(result.response, JSON.stringify(['OK', 'event-id', false, 'blocked']));
});

Deno.test('eventSifterPolicy accepts client EVENT when all ES policies accept', async () => {
  const event = makeEvent();
  const message = ['EVENT', event];
  const acceptAll = () => ({ id: event.id, action: 'accept' as const, msg: '' });

  const result = await eventSifterPolicy(message, connectionInfo, [acceptAll]);
  assertEquals(result.action, 'accept');
  assertEquals(result.message, message);
});

Deno.test('eventSifterPolicy accepts client EVENT with no ES policies', async () => {
  const event = makeEvent();
  const message = ['EVENT', event];

  const result = await eventSifterPolicy(message, connectionInfo, []);
  assertEquals(result.action, 'accept');
  assertEquals(result.message, message);
});

Deno.test('eventSifterPolicy passes REQ messages through', async () => {
  const message = ['REQ', 'sub1', { kinds: [1] }];
  const result = await eventSifterPolicy(message, connectionInfo, []);
  assertEquals(result.action, 'next');
  assertEquals(result.message, message);
});

Deno.test('eventSifterPolicy accepts EVENT when all ES policies accept', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];
  const acceptAll = () => ({ id: event.id, action: 'accept' as const, msg: '' });

  const result = await eventSifterPolicy(message, connectionInfo, [acceptAll]);
  assertEquals(result.action, 'accept');
  assertEquals(result.message, message);
});

Deno.test('eventSifterPolicy rejects EVENT when ES policy rejects', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];
  const rejectAll = () => ({ id: event.id, action: 'reject' as const, msg: 'blocked' });

  const result = await eventSifterPolicy(message, connectionInfo, [rejectAll]);
  assertEquals(result.action, 'reject');
  assertEquals(result.response, JSON.stringify(['OK', 'event-id', false, 'blocked']));
});

Deno.test('eventSifterPolicy rejects EVENT when ES policy shadowRejects', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];
  const shadowReject = () => ({ id: event.id, action: 'shadowReject' as const, msg: 'shadow' });

  const result = await eventSifterPolicy(message, connectionInfo, [shadowReject]);
  assertEquals(result.action, 'reject');
  assertEquals(result.response, undefined);
});

Deno.test('eventSifterPolicy shadow rejects client EVENT with accepted OK response', async () => {
  const event = makeEvent();
  const message = ['EVENT', event];
  const shadowReject = () => ({ id: event.id, action: 'shadowReject' as const, msg: 'shadow' });

  const result = await eventSifterPolicy(message, connectionInfo, [shadowReject]);
  assertEquals(result.action, 'reject');
  assertEquals(result.response, JSON.stringify(['OK', 'event-id', true, '']));
});

Deno.test('eventSifterPolicy stops pipeline at first non-accept ES policy', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];
  let callCount = 0;
  const reject = () => {
    callCount++;
    return { id: event.id, action: 'reject' as const, msg: 'blocked' };
  };
  const shouldNotBeCalled = () => {
    callCount++;
    return { id: event.id, action: 'accept' as const, msg: '' };
  };

  const result = await eventSifterPolicy(message, connectionInfo, [reject, shouldNotBeCalled]);
  assertEquals(result.action, 'reject');
  assertEquals(callCount, 1);
});

Deno.test('eventSifterPolicy accepts EVENT with no ES policies', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];

  const result = await eventSifterPolicy(message, connectionInfo, []);
  assertEquals(result.action, 'accept');
});

Deno.test('eventSifterPolicy constructs correct ESInputMessage for IPv4', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];
  const ipv4Info = { ...connectionInfo, connectionIpAddr: '192.168.1.1' };

  let capturedMsg: any;
  const capturePolicy = (msg: any) => {
    capturedMsg = msg;
    return { id: event.id, action: 'accept' as const, msg: '' };
  };

  await eventSifterPolicy(message, ipv4Info, [capturePolicy]);
  assertEquals(capturedMsg.sourceType, 'IP4');
  assertEquals(capturedMsg.sourceInfo, '192.168.1.1');
  assertEquals(capturedMsg.type, 'new');
  assertEquals(capturedMsg.event, event);
});

Deno.test('eventSifterPolicy constructs correct ESInputMessage for IPv6', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];
  const ipv6Info = { ...connectionInfo, connectionIpAddr: '::1' };

  let capturedMsg: any;
  const capturePolicy = (msg: any) => {
    capturedMsg = msg;
    return { id: event.id, action: 'accept' as const, msg: '' };
  };

  await eventSifterPolicy(message, ipv6Info, [capturePolicy]);
  assertEquals(capturedMsg.sourceType, 'IP6');
  assertEquals(capturedMsg.sourceInfo, '::1');
});

Deno.test('eventSifterPolicy constructs correct ESInputMessage for full IPv6', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];
  const ipv6Info = { ...connectionInfo, connectionIpAddr: '2001:0db8:85a3:0000:0000:8a2e:0370:7334' };

  let capturedMsg: any;
  const capturePolicy = (msg: any) => {
    capturedMsg = msg;
    return { id: event.id, action: 'accept' as const, msg: '' };
  };

  await eventSifterPolicy(message, ipv6Info, [capturePolicy]);
  assertEquals(capturedMsg.sourceType, 'IP6');
  assertEquals(capturedMsg.sourceInfo, '2001:0db8:85a3:0000:0000:8a2e:0370:7334');
});

Deno.test('eventSifterPolicy falls back to Stream for non-IP string', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];
  const streamInfo = { ...connectionInfo, connectionIpAddr: 'not-an-ip' };

  let capturedMsg: any;
  const capturePolicy = (msg: any) => {
    capturedMsg = msg;
    return { id: event.id, action: 'accept' as const, msg: '' };
  };

  await eventSifterPolicy(message, streamInfo, [capturePolicy]);
  assertEquals(capturedMsg.sourceType, 'Stream');
  assertEquals(capturedMsg.sourceInfo, 'not-an-ip');
});

Deno.test('eventSifterPolicy classifies empty string IP as Stream', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];
  const emptyInfo = { ...connectionInfo, connectionIpAddr: '' };

  let capturedMsg: any;
  const capturePolicy = (msg: any) => {
    capturedMsg = msg;
    return { id: event.id, action: 'accept' as const, msg: '' };
  };

  await eventSifterPolicy(message, emptyInfo, [capturePolicy]);
  assertEquals(capturedMsg.sourceType, 'Stream');
  assertEquals(capturedMsg.sourceInfo, '');
});

Deno.test('eventSifterPolicy falls back to Stream for localhost', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];
  const localhostInfo = { ...connectionInfo, connectionIpAddr: 'localhost' };

  let capturedMsg: any;
  const capturePolicy = (msg: any) => {
    capturedMsg = msg;
    return { id: event.id, action: 'accept' as const, msg: '' };
  };

  await eventSifterPolicy(message, localhostInfo, [capturePolicy]);
  assertEquals(capturedMsg.sourceType, 'Stream');
  assertEquals(capturedMsg.sourceInfo, 'localhost');
});

Deno.test('eventSifterPolicy throws when esPolicies is undefined', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];

  await assertRejects(
    async () => await eventSifterPolicy(message, connectionInfo, undefined),
    TypeError,
  );
});

Deno.test('eventSifterPolicy accepts EVENT when multiple ES policies all accept', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];
  let callCount = 0;
  const accept1 = () => {
    callCount++;
    return { id: event.id, action: 'accept' as const, msg: '' };
  };
  const accept2 = () => {
    callCount++;
    return { id: event.id, action: 'accept' as const, msg: '' };
  };
  const accept3 = () => {
    callCount++;
    return { id: event.id, action: 'accept' as const, msg: '' };
  };

  const result = await eventSifterPolicy(message, connectionInfo, [accept1, accept2, accept3]);
  assertEquals(result.action, 'accept');
  assertEquals(callCount, 3);
});

Deno.test('eventSifterPolicy works with async ES policies', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];
  const asyncAccept = async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    return { id: event.id, action: 'accept' as const, msg: '' };
  };

  const result = await eventSifterPolicy(message, connectionInfo, [asyncAccept]);
  assertEquals(result.action, 'accept');
  assertEquals(result.message, message);
});

Deno.test('eventSifterPolicy works with async ES policy that rejects', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];
  const asyncReject = async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    return { id: event.id, action: 'reject' as const, msg: 'async-blocked' };
  };

  const result = await eventSifterPolicy(message, connectionInfo, [asyncReject]);
  assertEquals(result.action, 'reject');
  assertEquals(result.response, JSON.stringify(['OK', 'event-id', false, 'async-blocked']));
});

Deno.test('eventSifterPolicy works with ESPolicyTuple format', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];

  let capturedOpts: any;
  const policyWithOpts = (_msg: any, opts?: any) => {
    capturedOpts = opts;
    return { id: event.id, action: 'accept' as const, msg: '' };
  };

  const result = await eventSifterPolicy(message, connectionInfo, [[policyWithOpts, { threshold: 5 }] as any]);
  assertEquals(result.action, 'accept');
  assertEquals(capturedOpts, { threshold: 5 });
});

Deno.test('eventSifterPolicy passes EVENT with 4+ elements through', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event, 'extra'];

  const result = await eventSifterPolicy(message, connectionInfo, []);
  assertEquals(result.action, 'next');
  assertEquals(result.message, message);
});

Deno.test('eventSifterPolicy works with ESPolicyTuple without options', async () => {
  const event = makeEvent();
  const message = ['EVENT', 'sub1', event];

  const acceptPolicy = () => ({ id: event.id, action: 'accept' as const, msg: '' });

  const result = await eventSifterPolicy(message, connectionInfo, [[acceptPolicy] as any]);
  assertEquals(result.action, 'accept');
});
