import { assertEquals, assertStrictEquals } from '@std/assert';

class FakeDocument {
  listeners = [];

  addEventListener(type, listener) {
    this.listeners.push({ type, listener });
  }
}

class FakeWindow {
  listeners = [];

  addEventListener(type, listener) {
    this.listeners.push({ type, listener });
  }
}

function setGlobal(name, value) {
  const hadValue = Object.prototype.hasOwnProperty.call(globalThis, name);
  const previousValue = globalThis[name];

  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
  });

  return () => {
    if (hadValue) {
      Object.defineProperty(globalThis, name, {
        value: previousValue,
        configurable: true,
      });
    } else {
      delete globalThis[name];
    }
  };
}

async function importFreshNav() {
  return await import(`./fresh_nav.js?test=${crypto.randomUUID()}`);
}

Deno.test('fresh nav boot stores Fresh island boot arguments', async () => {
  const document = new FakeDocument();
  const window = new FakeWindow();
  const restoreDocument = setGlobal('document', document);
  const restoreWindow = setGlobal('window', window);
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();
    const islands = { AdminIslandSmoke: () => null };
    const props = '[[1],{"slots":2,"props":3},[],{}]';

    boot(islands, props);

    const args = globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;
    assertStrictEquals(args?.islands, islands);
    assertStrictEquals(args?.props, props);
    assertEquals(document.listeners.map((entry) => entry.type), ['click']);
    assertEquals(window.listeners.map((entry) => entry.type), ['popstate']);
  } finally {
    restoreBootArgs();
    restoreWindow();
    restoreDocument();
  }
});
