# YouTube New Order 🚀

Transform YouTube with custom layout swapping, powerful video tools, and advanced content filtering.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome)
![Version](https://img.shields.io/badge/version-1.0.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## 🌟 Why Use This Extension?

YouTube New Order completely redesigns your YouTube viewing experience. Whether you want comments on the right side while watching videos, a distraction-free environment, or powerful tools like video notes and timestamps, this extension has it all.

---

## 🔥 Key Features

### 📐 **Layout Customization**
- **Comment Swapping**: Move comments to the right sidebar and related videos to the bottom.
- **Multiple Modes**:
  - **Swapped**: Comments on Right (Classic style).
  - **Comments Left**: Comments on Left, Video Center.
  - **Triple Column**: Video Center, Comments Left, Related Right (or vice versa).
  - **Minimal**: Remove distractions, focus on video.
  - **Focus Mode**: Hide everything except the video player.
  - **Theater Mode**: Enhanced theater experience.
- **Resizable Columns**: Adjust width of comments and related videos.
- **Collapsible Sections**: hide/show comments or related videos on demand.

### 🎥 **Video Enhancements**
- **Volume Boost**: Increase volume beyond 100%.
- **Picture-in-Picture Comments**: View comments in a floating window while scrolling.
- **Video Notes**: Take timestamped notes on videos.
- **Timestamp Bookmarks**: Save specific moments in videos.
- **Controls**: Copy Timestamp, Quick Screenshot, Skip Intro, Skip Ads.

### 💬 **Comment Management**
- **Search Comments**: Find specific keywords in comments.
- **Advanced Filters**: Filter by keywords, user, or sentiment.
- **Auto-load Comments**: Automatically load more comments as you scroll.
- **Highlight Comments**: Make comments stand out.

### 🚫 **Distraction Free**
- **Hide Shorts**: Remove Shorts from feed and sidebar.
- **Hide Ads**: Block video ads and banner ads.
- **Hide Clickbait**: Blur or hide clickbait thumbnails/titles.
- **Element Hiding**: Hide Description, Channel Info, Merch Shelf, End Screens.

### 📚 **Productivity & Organization**
- **Enhanced Playlist Manager**: Create and manage playlists easily.
- **Watch Later Quick Add**: Add videos to Watch Later with one click.
- **History Search**: Search your watch history more effectively.

---

## 🛠️ Installation (Developer Mode)

1. **Download or Clone** this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/youtube-new-order.git
   ```

2. **Open Chrome Extensions Page**:
   - Navigate to `chrome://extensions/`
   - Or: Menu → Extensions → Manage Extensions

3. **Enable Developer Mode**:
   - Toggle the switch in the top-right corner.

4. **Load the Extension**:
   - Click **"Load unpacked"**.
   - Select the `youtube-new-order` folder (where `manifest.json` is located).

5. **Pin to Toolbar**:
   - Click the extension puzzle piece icon in Chrome toolbar.
   - Pin **YouTube New Order** for quick access.

---

## ⚙️ How to Use

1. **Popup Menu**: Click the extension icon to toggle the main features or open full settings.
2. **Settings Page**: Accessible from the popup, this page allows granular control over every aspect of the extension.
3. **On YouTube**:
   - Navigate to any video page.
   - The layout will automatically adjust based on your settings.
   - Use the floating tools or keyboard shortcuts as configured.

---

## 📂 Project Structure

```
youtube-new-order/
├── manifest.json       # Extension configuration
├── background.js       # Background service worker
├── content.js          # Core logic (DOM manipulation, features)
├── styles.css          # Styling for layouts and UI elements
├── popup.html          # Quick access menu HTML
├── popup.js            # Popup logic
├── settings.html       # Full configuration interface
├── settings.js         # Settings page logic
├── settings.css        # Settings page styling
├── icons/              # Extension icons
└── README.md           # Documentation
```

---

## 🤝 Contributing

We welcome contributions!
- Report bugs via Issues.
- Request features.
- Submit Pull Requests with improvements.

## 📝 License

MIT License - Free to use and modify.

---

**Enjoy your new YouTube experience!** 🚀
