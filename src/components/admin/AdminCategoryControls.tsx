import { type Category } from '@/lib/store';
import { Edit, Trash2 } from 'lucide-react';
import { useState } from 'react';

/**
 * Simple admin controls for a given category.
 * Currently provides placeholder Edit and Delete actions.
 * Extend as needed for full admin functionality.
 */
export function AdminCategoryControls({
  category,
}: {
  category: Category;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleEdit = () => {
    // TODO: Implement edit navigation or modal
    console.log('Edit category', category.slug);
  };

  const handleDelete = async () => {
    if (confirm(`Delete category "${category.name}"? This action cannot be undone.`)) {
      setDeleting(true);
      // Placeholder for delete logic
      await new Promise((res) => setTimeout(res, 500));
      console.log('Deleted category', category.slug);
      setDeleting(false);
    }
  };

  return (
    <div className="absolute top-2 right-2 flex gap-2 opacity-80 hover:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={handleEdit}
        className="p-1 rounded bg-primary/10 text-primary hover:bg-primary/20"
        title="Edit category"
      >
        <Edit size={16} />
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="p-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20"
        title="Delete category"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
