import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Modal } from '../ui/Overlay'
import { Field, Textarea } from '../ui/Form'
import { tr } from '../../i18n/strings'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  /** Show a reason box; when `reasonRequired` the confirm button needs 5+ characters. */
  reason?: boolean
  reasonRequired?: boolean
  reasonLabel?: string
  reasonPlaceholder?: string
  onConfirm: (reason: string) => void
}

export function ConfirmDialog({ options, onClose }: { options: ConfirmOptions | null; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  // Reset the reason when a new dialog opens (state adjusted during render, not in an effect).
  const [shown, setShown] = useState(options)
  if (shown !== options) { setShown(options); setReason(''); setTouched(false) }
  if (!options) return null
  const invalid = !!options.reasonRequired && reason.trim().length < 5
  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-md"
      title={
        <span className="flex items-center gap-3">
          <span className={options.danger ? 'grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-rose-50 text-rose-500' : 'grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-500'}>
            <TriangleAlert size={20} />
          </span>
          {options.title}
        </span>
      }
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>{tr("Cancel")}</button>
          <button
            className={options.danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => {
              setTouched(true)
              if (invalid) return
              options.onConfirm(reason.trim())
              onClose()
            }}
          >
            {options.confirmLabel ?? tr("Confirm")}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted">{options.message}</p>
      {(options.reason || options.reasonRequired) && (
        <Field className="mt-4" label={options.reasonLabel ?? tr("Reason")} required={options.reasonRequired} hint={touched && invalid ? <span className="text-rose-500">{tr("Please enter a reason (at least 5 characters).")}</span> : tr("Shared with the organizers.")}>
          <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={options.reasonPlaceholder ?? tr("Tell us why")} className={touched && invalid ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : ''} />
        </Field>
      )}
    </Modal>
  )
}
