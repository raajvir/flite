/** Tiny helper for building flat-shaded, vertex-coloured triangle meshes. */
import * as THREE from 'three';

export class Builder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  private readonly c = new THREE.Color();

  tri(a: number[], b: number[], c: number[], color: string | number): void {
    this.c.set(color);
    for (const p of [a, b, c]) {
      this.pos.push(p[0]!, p[1]!, p[2]!);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  /** Quad a-b-c-d. */
  quad(a: number[], b: number[], c: number[], d: number[], color: string | number): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  mesh(material: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }
}
