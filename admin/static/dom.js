export function append(parent, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    child.forEach((item) => append(parent, item));
    return;
  }
  parent.appendChild(
    child instanceof Node ? child : document.createTextNode(String(child)),
  );
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'className' || key === 'class') {
      node.className = String(value);
    } else if (key === 'dataset') {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        node.dataset[dataKey] = String(dataValue);
      }
    } else if (key === 'attrs') {
      for (const [attrKey, attrValue] of Object.entries(value)) {
        if (attrValue !== null && attrValue !== undefined && attrValue !== false) {
          node.setAttribute(attrKey, String(attrValue));
        }
      }
    } else if (key === 'events') {
      for (const [eventName, handler] of Object.entries(value)) {
        node.addEventListener(eventName, handler);
      }
    } else if (key === 'style') {
      if (typeof value === 'string') {
        node.style.cssText = value;
      } else {
        Object.assign(node.style, value);
      }
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'htmlFor') {
      node.htmlFor = String(value);
    } else if (key === 'value') {
      node.value = String(value);
    } else if (key === 'checked') {
      node.checked = Boolean(value);
    } else if (key === 'disabled') {
      node.disabled = Boolean(value);
    } else if (key === 'selected') {
      node.selected = Boolean(value);
    } else if (key === 'colSpan') {
      node.colSpan = Number(value);
    } else if (key === 'spellcheck') {
      node.spellcheck = Boolean(value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  append(node, children);
  return node;
}

export function button(text, className, props = {}) {
  return el('button', { type: 'button', className, ...props }, [text]);
}

export function pageHeader(title, actions = [], extra = null) {
  const children = [
    el('h1', { className: 'page-title' }, [title]),
  ];
  if (actions.length > 0) {
    children.push(el('div', { className: 'flex gap-2 items-center' }, actions));
  } else if (extra) {
    children.push(extra);
  }
  return el('div', { className: 'page-header' }, children);
}

export function statCard(title, value, subtitle, valueId = null, valueStyle = null) {
  const valueProps = { className: 'card-value' };
  if (valueId) valueProps.id = valueId;
  if (valueStyle) valueProps.style = valueStyle;
  const children = [
    el('div', { className: 'card-title' }, [title]),
    el('div', valueProps, [value]),
  ];
  if (subtitle !== null && subtitle !== undefined) {
    children.push(el('div', { className: 'card-subtitle' }, [subtitle]));
  }
  return el('div', { className: 'card' }, children);
}

export function loadingRow(colSpan, text = 'Loading...') {
  return el('tr', {}, [
    el('td', {
      colSpan,
      style: 'text-align:center;padding:24px;color:var(--color-text-muted)',
    }, [text]),
  ]);
}

export function table(headers, tbodyId, loadingColSpan) {
  return el('table', { className: 'table' }, [
    el('thead', {}, [
      el(
        'tr',
        {},
        headers.map((header) => {
          const props = typeof header === 'string' ? {} : { style: header.style };
          return el('th', props, [typeof header === 'string' ? header : header.text]);
        }),
      ),
    ]),
    el('tbody', { id: tbodyId }, [loadingRow(loadingColSpan)]),
  ]);
}

export function actionForm(action, text, className, confirmMessage = null) {
  return el('form', {
    method: 'POST',
    action,
    style: 'display:inline',
    events: confirmMessage
      ? {
        submit: (event) => {
          if (!confirm(confirmMessage)) event.preventDefault();
        },
      }
      : {},
  }, [
    el('button', { type: 'submit', className }, [text]),
  ]);
}

export function chartContainer(children, props = {}) {
  return el('div', { className: 'chart-container', ...props }, children);
}

export function loadingState(text = 'Loading...') {
  return el('span', { className: 'text-muted' }, [text]);
}
