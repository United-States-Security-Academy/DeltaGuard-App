'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui';

/** The row checkboxes that belong to the bulk form (outside it in the DOM). */
function boxes(formId: string): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(
      `input[type="checkbox"][name="id"][form="${formId}"]`,
    ),
  );
}

/** Header checkbox: select or clear every downloadable row. */
export function SelectAll({ formId, disabled }: { formId: string; disabled: boolean }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      disabled={disabled}
      onChange={(e) => {
        for (const box of boxes(formId)) box.checked = e.target.checked;
        document.dispatchEvent(new Event('bulk-selection'));
      }}
    />
  );
}

/** "Download N as ZIP": submits the selected ids to the server, which builds the ZIP. */
export function BulkDownload({ formId, available }: { formId: string; available: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const recount = () => setCount(boxes(formId).filter((b) => b.checked).length);
    recount();
    document.addEventListener('change', recount);
    document.addEventListener('bulk-selection', recount);
    return () => {
      document.removeEventListener('change', recount);
      document.removeEventListener('bulk-selection', recount);
    };
  }, [formId]);

  if (available === 0) return null;
  return (
    <>
      <Button type="submit" form={formId} variant="secondary" disabled={count === 0}>
        {count === 0 ? 'Select PDFs to download' : `Download ${count} as ZIP`}
      </Button>
      <span className="text-xs text-muted">Only submitted forms have a PDF.</span>
    </>
  );
}
