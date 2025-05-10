import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.project.findMany();
  }

  async findOne(id: number) {
    const project = await this.prisma.project.findUnique({
      where: { id },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  async create(createProjectDto: CreateProjectDto, userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
  
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }
  
    const project = await this.prisma.project.create({
      data: {
        ...createProjectDto,
        collaborators: {
          connect: [{ id: userId }],
        },
      },
      include: {
        collaborators: true,
      },
    });
  
    return project;
  }
  

  async update(id: number, updateProjectDto: UpdateProjectDto) {
    await this.findOne(id);

    return this.prisma.project.update({
      where: { id },
      data: updateProjectDto,
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    await this.prisma.project.delete({
      where: { id },
    });
    
    return null;
  }
}