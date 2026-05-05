import { useNavigate } from 'react-router-dom';
import { clearPortalSession, usePortalUser } from '../../hooks/usePortalUser';

export function PortalUserMenu() {
  const navigate = useNavigate();
  const user = usePortalUser();

  if (!user) return null;

  return (
    <div className="portal-user-menu">
      <span className="portal-user-name">{user.name}</span>
      <button
        type="button"
        className="portal-btn-link"
        onClick={() => {
          clearPortalSession();
          navigate('/portal', { replace: true });
        }}
      >
        Sair
      </button>
    </div>
  );
}
