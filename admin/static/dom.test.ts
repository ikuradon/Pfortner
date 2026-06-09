import { assertEquals } from '@std/assert';
import { el } from './dom.js';

class FakeNode {
  children: unknown[] = [];

  appendChild(child: unknown): void {
    this.children.push(child);
  }
}

class FakeElement extends FakeNode {
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, unknown> & { cssText?: string } = {};
  readonly attributes: Record<string, string> = {};
  className = '';
  textContent = '';

  constructor(
    readonly tagName: string,
    readonly namespaceURI: string,
  ) {
    super();
  }

  setAttribute(key: string, value: string): void {
    this.attributes[key] = value;
  }

  addEventListener(): void {
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, 'http://www.w3.org/1999/xhtml');
  }

  createElementNS(namespaceURI: string, tagName: string): FakeElement {
    return new FakeElement(tagName, namespaceURI);
  }

  createTextNode(value: string): FakeNode & { value: string } {
    return Object.assign(new FakeNode(), { value });
  }
}

Deno.test('dom helper creates svg shells in the SVG namespace', () => {
  const globals = globalThis as typeof globalThis & {
    document?: unknown;
    Node?: unknown;
  };
  const previousDocument = globals.document;
  const previousNode = globals.Node;
  try {
    Object.defineProperty(globalThis, 'document', {
      value: new FakeDocument(),
      configurable: true,
    });
    Object.defineProperty(globalThis, 'Node', {
      value: FakeNode,
      configurable: true,
    });

    const svg = el('svg', {
      className: 'pipeline-svg',
      id: 'pipeline-svg',
    }) as unknown as FakeElement;

    assertEquals(svg.namespaceURI, 'http://www.w3.org/2000/svg');
    assertEquals(svg.attributes.class, 'pipeline-svg');
    assertEquals(svg.attributes.id, 'pipeline-svg');
  } finally {
    Object.defineProperty(globalThis, 'document', {
      value: previousDocument,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'Node', {
      value: previousNode,
      configurable: true,
    });
  }
});
