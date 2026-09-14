import { PermissionGuard } from '@/components/shared/RoleGuard';
import { WorkbookScreen } from '@/features/workbook/WorkbookScreen';

/**
 * Writing workbooks, for a student an admin has trusted with it.
 *
 * The same screen a teacher uses. It lists only what this person wrote, and
 * the rules let them publish only with the permission to do so.
 */
export default function ManageWorkbooks() {
  return (
    <PermissionGuard permission="CREATE_WORKBOOK">
      <WorkbookScreen />
    </PermissionGuard>
  );
}
