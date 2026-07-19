import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import path from 'path';
import { buildAssetsDir } from './paths';

export function createTray(
  getWindow: () => BrowserWindow | null,
  createWindow: () => BrowserWindow,
  onRefreshNow: () => void
): Tray {
  const iconPath = path.join(buildAssetsDir(), 'trayTemplate.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(path.join(buildAssetsDir(), 'icon.png')).resize({ width: 18, height: 18 });
  } else {
    icon.setTemplateImage(true);
  }

  const tray = new Tray(icon);
  tray.setToolTip('Catch Up');

  const showOrCreateWindow = () => {
    const existing = getWindow();
    if (existing) {
      existing.show();
      existing.focus();
    } else {
      createWindow();
    }
  };

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Catch Up', click: showOrCreateWindow },
      { label: 'Refresh Now', click: onRefreshNow },
      { type: 'separator' },
      { label: 'Quit Catch Up', click: () => app.quit() },
    ])
  );
  tray.on('click', showOrCreateWindow);
  return tray;
}
