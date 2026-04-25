// Sticky footer for ProductEditDrawer.
//
// Three actions: Reset (revert draft to DB values), Cancel (close, drop
// edits), Save (PUT replace_all).

type Props = {
  saving: boolean;
  onReset: () => void;
  onCancel: () => void;
  onSave: () => void;
};

export function DrawerFooter({ saving, onReset, onCancel, onSave }: Props) {
  const disabled = saving ? { disabled: true } : {};
  return (
    <div className="ped-footer">
      <s-button onClick={onReset} {...disabled}>
        Reset
      </s-button>
      <s-button onClick={onCancel} {...disabled}>
        Cancel
      </s-button>
      <s-button
        variant="primary"
        onClick={onSave}
        {...(saving ? { loading: true, disabled: true } : {})}
      >
        Save changes
      </s-button>
    </div>
  );
}
