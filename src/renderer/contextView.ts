import { CHECKPOINT_FIELDS, type TaskCheckpoint, type ContextReceipt } from '../shared/context';

const LABELS = { constraints: 'Constraints', decisions: 'Decisions and reasons', progress: 'Reported progress', openQuestions: 'Open questions', nextSteps: 'Next steps' };
const text = (tag: string, value: string) => { const node = document.createElement(tag); node.textContent = value; return node; };

export function checkpointPanel(checkpoint: TaskCheckpoint, onSource: (id: string) => void): HTMLElement {
  const panel = document.createElement('div'); panel.className = 'checkpoint';
  panel.append(text('p', `Checkpoint v${checkpoint.version} · ${new Date(checkpoint.updatedAt).toLocaleString()}`));
  panel.append(text('p', 'Model-generated task state. Follow the source links to verify a claim.'));
  const fields = [['Goal', checkpoint.goal ? [checkpoint.goal] : []], ...CHECKPOINT_FIELDS.map((key) => [LABELS[key], checkpoint[key]] as const)] as const;
  for (const [label, items] of fields) {
    if (!items.length) continue;
    panel.append(text('h3', label)); const list = document.createElement('ul');
    for (const item of items) {
      const li = text('li', item.text);
      item.sourceIds.forEach((id, i) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'source-link secondary'; button.textContent = `Source ${i + 1}`; button.title = id;
        button.addEventListener('click', () => onSource(id)); li.append(button);
      });
      list.append(li);
    }
    panel.append(list);
  }
  return panel;
}

export function contextReceiptPanel(receipt: ContextReceipt, onSource: (id: string) => void): HTMLDetailsElement {
  const panel = document.createElement('details'); panel.className = 'context-receipt';
  panel.dataset.contextReceipt = receipt.id;
  panel.append(text('summary', `Context used · ${receipt.facts.length} facts · ${receipt.checkpoint ? 'task checkpoint' : 'no checkpoint'} · ${receipt.sources.length + (receipt.toolSources?.length ?? 0)} source excerpts`));
  panel.append(text('p', `Supplied before this turn · ${new Date(receipt.createdAt).toLocaleString()} · ${receipt.outcome}`));
  panel.append(text('p', 'This shows what Circe supplied. The model’s reasoning is not observable here. Tool lookups below show source excerpts returned during the turn.'));
  for (const fact of receipt.facts) panel.append(text('p', `${fact.text}\nEvidence: ${fact.evidence}`));
  if (receipt.checkpoint) panel.append(checkpointPanel(receipt.checkpoint, onSource));
  for (const source of receipt.sources) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = `Read ${source.role} source`;
    button.addEventListener('click', () => onSource(source.id));
    panel.append(button, text('blockquote', source.text));
  }
  if (receipt.toolSources?.length) {
    panel.append(text('h3', 'Sources retrieved by tools'));
    for (const source of receipt.toolSources) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = `Read ${source.role} source`;
      button.addEventListener('click', () => onSource(source.id)); panel.append(button, text('blockquote', source.text));
    }
  }
  return panel;
}
