import { ROAD_EDGES, ROAD_NODES, WORLD_BOUNDS, WORLD_LOCATIONS, type Point2, type WorldLocation } from '../../shared/world';

interface MapState {
  player: Point2;
  heading: number;
  route: Point2[];
  waypointId: string | null;
  remotes: { id: string; name: string; x: number; z: number }[];
}

export class GameMap {
  private state: MapState = { player: { x: 0, z: 0 }, heading: 0, route: [], waypointId: null, remotes: [] };
  onWaypoint?: (locationId: string) => void;

  constructor(private readonly minimap: HTMLCanvasElement, private readonly fullmap: HTMLCanvasElement) {
    fullmap.addEventListener('click', (event) => {
      const rect = fullmap.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const point = this.screenToWorld(x, y, rect.width, rect.height, false);
      let nearest: WorldLocation | undefined;
      let nearestDistance = 24;
      for (const location of WORLD_LOCATIONS) {
        const distance = Math.hypot(point.x - location.x, point.z - location.z);
        if (distance < nearestDistance) { nearest = location; nearestDistance = distance; }
      }
      if (nearest) this.onWaypoint?.(nearest.id);
    });
  }

  update(state: MapState) {
    this.state = state;
    this.draw(this.minimap, true);
    if (this.fullmap.offsetParent !== null) this.draw(this.fullmap, false);
  }

  private draw(canvas: HTMLCanvasElement, mini: boolean) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext('2d')!;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = '#e7e2d5'; context.fillRect(0, 0, rect.width, rect.height);

    const project = (point: Point2) => this.worldToScreen(point, rect.width, rect.height, mini);
    const waterTopLeft = project({ x: WORLD_BOUNDS.minX - 500, z: WORLD_BOUNDS.minZ - 200 });
    const waterBottomRight = project({ x: -157, z: WORLD_BOUNDS.maxZ + 200 });
    context.fillStyle = '#8db7b3';
    context.fillRect(waterTopLeft.x, waterTopLeft.y, waterBottomRight.x - waterTopLeft.x, waterBottomRight.y - waterTopLeft.y);
    const sandStart = project({ x: -157, z: WORLD_BOUNDS.minZ });
    const sandEnd = project({ x: -140, z: WORLD_BOUNDS.maxZ });
    context.fillStyle = '#d2c194'; context.fillRect(sandStart.x, sandEnd.y, sandEnd.x - sandStart.x, sandStart.y - sandEnd.y);

    context.lineCap = 'round'; context.lineJoin = 'round';
    for (const pass of [0, 1]) {
      context.strokeStyle = pass === 0 ? '#a8a79c' : '#f8f5ec';
      context.lineWidth = pass === 0 ? (mini ? 7 : 11) : (mini ? 4 : 7);
      for (const edge of ROAD_EDGES) {
        const from = ROAD_NODES.find((node) => node.id === edge.from)!;
        const to = ROAD_NODES.find((node) => node.id === edge.to)!;
        const a = project(from); const b = project(to);
        context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
      }
    }

    if (this.state.route.length > 1) {
      context.strokeStyle = '#d99f2b'; context.lineWidth = mini ? 3 : 4;
      context.setLineDash(mini ? [] : [7, 4]);
      context.beginPath();
      this.state.route.forEach((point, index) => {
        const screen = project(point);
        if (index === 0) context.moveTo(screen.x, screen.y); else context.lineTo(screen.x, screen.y);
      });
      context.stroke(); context.setLineDash([]);
    }

    for (const location of WORLD_LOCATIONS) {
      const screen = project(location);
      if (!this.visible(screen, rect)) continue;
      const active = this.state.waypointId === location.id;
      context.fillStyle = active ? '#d79622' : '#244b46';
      context.beginPath(); context.arc(screen.x, screen.y, active ? (mini ? 5 : 8) : (mini ? 3 : 5), 0, Math.PI * 2); context.fill();
      if (!mini) {
        context.fillStyle = '#203d39'; context.font = `${active ? 700 : 600} 12px Arial`; context.textAlign = 'center';
        context.fillText(location.shortName, screen.x, screen.y - 12);
      }
    }

    for (const remote of this.state.remotes) {
      const screen = project(remote);
      if (!this.visible(screen, rect)) continue;
      context.fillStyle = '#b45143'; context.beginPath(); context.arc(screen.x, screen.y, mini ? 3 : 5, 0, Math.PI * 2); context.fill();
      if (!mini) { context.fillStyle = '#6b362f'; context.font = '11px Arial'; context.fillText(remote.name, screen.x, screen.y + 16); }
    }

    const player = project(this.state.player);
    context.save(); context.translate(player.x, player.y); context.rotate(Math.PI - this.state.heading);
    context.fillStyle = '#c24f3e'; context.strokeStyle = '#fffaf0'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(0, -9); context.lineTo(6, 7); context.lineTo(0, 4); context.lineTo(-6, 7); context.closePath(); context.fill(); context.stroke();
    context.restore();

    if (!mini) {
      context.fillStyle = '#25443f'; context.font = '700 13px Arial'; context.textAlign = 'left'; context.fillText('N', 18, 25);
      context.beginPath(); context.moveTo(22, 33); context.lineTo(18, 43); context.lineTo(26, 43); context.closePath(); context.fill();
      context.font = '11px Arial'; context.fillStyle = '#65736b'; context.fillText('GAME DISTRICT • NOT TO SCALE', 16, rect.height - 15);
    }
  }

  private worldToScreen(point: Point2, width: number, height: number, mini: boolean) {
    if (mini) {
      const scale = Math.min(width, height) / 150;
      return { x: width / 2 + (point.x - this.state.player.x) * scale, y: height / 2 + (point.z - this.state.player.z) * scale };
    }
    const padding = 44;
    const scale = Math.min((width - padding * 2) / (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX), (height - padding * 2) / (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ));
    return { x: width / 2 + (point.x - (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2) * scale, y: height / 2 + (point.z - (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2) * scale };
  }

  private screenToWorld(x: number, y: number, width: number, height: number, mini: boolean): Point2 {
    const padding = 44;
    const scale = mini ? Math.min(width, height) / 150 : Math.min((width - padding * 2) / (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX), (height - padding * 2) / (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ));
    const center = mini ? this.state.player : { x: (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2, z: (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2 };
    return { x: center.x + (x - width / 2) / scale, z: center.z + (y - height / 2) / scale };
  }

  private visible(point: { x: number; y: number }, rect: DOMRect) { return point.x > -20 && point.y > -20 && point.x < rect.width + 20 && point.y < rect.height + 20; }
}
