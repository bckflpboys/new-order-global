document.addEventListener('DOMContentLoaded', async () => {
  const user = await NewOrderAuth.init();
  if (!user) {
    window.location.href = '../builder/builder.html';
    return;
  }

  // Populate user data
  document.getElementById('user-email').value = user.email;
  if (user.displayName) {
    document.getElementById('display-name').value = user.displayName;
  }

  // Profile form handler
  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = document.getElementById('display-name').value.trim();
    
    if (!displayName) {
      alert('Display name is required');
      return;
    }

    try {
      const response = await fetch(`${NewOrderAPI.BASE_URL}/api/user/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({ displayName })
      });

      if (response.ok) {
        alert('Profile updated successfully');
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to update profile');
      }
    } catch (error) {
      console.error('Profile update error:', error);
      alert('Failed to update profile. Please try again.');
    }
  });

  // Password form handler
  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;

    if (!currentPassword || !newPassword) {
      alert('Please fill in all password fields');
      return;
    }

    if (newPassword.length < 8) {
      alert('New password must be at least 8 characters');
      return;
    }

    try {
      const response = await fetch(`${NewOrderAPI.BASE_URL}/api/user/password`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      if (response.ok) {
        alert('Password updated successfully');
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to update password');
      }
    } catch (error) {
      console.error('Password update error:', error);
      alert('Failed to update password. Please try again.');
    }
  });

  // Delete account handler
  document.getElementById('btn-delete-account').addEventListener('click', async () => {
    const confirmed = confirm('Are you sure you want to delete your account? This action cannot be undone and will permanently delete all your data including saved tools.');
    
    if (!confirmed) return;

    const secondConfirmed = confirm('This is your last chance. Are you absolutely sure you want to delete your account?');
    
    if (!secondConfirmed) return;

    try {
      const response = await fetch(`${NewOrderAPI.BASE_URL}/api/user/account`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${user.token}`
        }
      });

      if (response.ok) {
        alert('Account deleted successfully');
        NewOrderAuth.logout();
        window.location.href = '../builder/builder.html';
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to delete account');
      }
    } catch (error) {
      console.error('Account deletion error:', error);
      alert('Failed to delete account. Please try again.');
    }
  });

  // Logout handler
  document.getElementById('btn-logout').addEventListener('click', () => {
    NewOrderAuth.logout();
    window.location.href = '../builder/builder.html';
  });
});
