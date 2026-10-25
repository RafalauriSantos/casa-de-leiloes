import { useState, type SyntheticEvent } from 'react';

/**
 * The form for the head of a receipt. It lives apart from the view because the page shows it also when the server
 * refused the head: a pasted head that is wrong must be possible to correct, or to clear, without editing the address.
 */
export function ReceiptForm({ head, onHead }: { head: string | undefined; onHead: (head: string) => void }) {
  const [typed, setTyped] = useState(head ?? '');

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    // The server accepts only lowercase hex, so a hash pasted in capitals is not refused for that.
    onHead(typed.trim().toLowerCase());
  };

  return (
    <form onSubmit={submit} aria-label="Conferir recibo">
      <label>
        Ponta do seu recibo
        <input value={typed} onChange={(event) => { setTyped(event.target.value); }} autoComplete="off" spellCheck={false} />
      </label>
      <button type="submit">Conferir</button>
      {head !== undefined && (
        <button type="button" className="link" onClick={() => { setTyped(''); onHead(''); }}>
          Limpar ponta
        </button>
      )}
    </form>
  );
}
