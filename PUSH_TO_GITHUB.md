# Push to GitHub Instructions

Your local repository is ready! Now follow these steps to push to GitHub:

## Option 1: Using GitHub Website (Recommended)

1. **Go to GitHub** and create a new repository:
   - Visit: https://github.com/new
   - Repository name: `youtube-new-order`
   - Description: "Chrome extension that reorders YouTube's layout - comments on the right, related videos at the bottom"
   - Make it **Public** (or Private if you prefer)
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
   - Click "Create repository"

2. **Copy the repository URL** that GitHub shows you (it will look like):
   ```
   https://github.com/YOUR_USERNAME/youtube-new-order.git
   ```

3. **Run these commands** in your terminal (replace YOUR_USERNAME with your GitHub username):
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/youtube-new-order.git
   git branch -M main
   git push -u origin main
   ```

## Option 2: Using GitHub CLI (if you have it installed)

```bash
gh repo create youtube-new-order --public --source=. --remote=origin --push
```

---

## What's Ready

✅ Git repository initialized
✅ All files committed
✅ Extension renamed to "YouTube New Order"
✅ Professional README with badges
✅ MIT License included
✅ .gitignore configured

Just create the GitHub repo and push! 🚀
