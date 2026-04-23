document.addEventListener('DOMContentLoaded', async () => {
  const user = await NewOrderAuth.checkAuth();
  if (user) {
    document.getElementById('user-email').value = user.email;
  } else {
    window.location.href = '../builder/builder.html'; // redirect to builder to login
  }
  document.getElementById('btn-logout').addEventListener('click', () => {
    NewOrderAuth.logout();
    window.location.href = '../builder/builder.html';
  });
});
