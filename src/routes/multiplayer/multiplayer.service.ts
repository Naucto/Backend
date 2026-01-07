import { Injectable } from "@nestjs/common";

@Injectable()
export class MultiplayerService {
  async openHost(userId: number, projectId: number): Promise<void> {

  }

  async closeHost(userId: number): Promise<void> {

  }

  async lookupHosts(projectId: number /*, criterion: Record<string, any(?)> */): Promise<void> {

  }

  async joinHost(hostId: string): Promise<void> {

  }

  async leaveHost(hostId: string): Promise<void> {
    
  }
}
