import { Test } from '@nestjs/testing'
import { AppModule } from '../app/app.module'
import { EnvironmentModule } from './environment.module'
import { MAIL_SERVICE } from '../mail/services/interface.service'
import { MockMailService } from '../mail/services/mock.service'
import {
  FastifyAdapter,
  NestFastifyApplication
} from '@nestjs/platform-fastify'
import { PrismaService } from '../prisma/prisma.service'
import {
  Environment,
  EventSeverity,
  EventSource,
  EventTriggerer,
  EventType,
  Project,
  ProjectAccessLevel,
  User,
  Workspace
} from '@prisma/client'
import fetchEvents from '../common/fetch-events'
import { ProjectModule } from '../project/project.module'
import { ProjectService } from '../project/service/project.service'
import { EventModule } from '../event/event.module'
import { EventService } from '../event/service/event.service'
import { EnvironmentService } from './service/environment.service'
import { UserModule } from '../user/user.module'
import { UserService } from '../user/service/user.service'

describe('Environment Controller Tests', () => {
  let app: NestFastifyApplication
  let prisma: PrismaService
  let projectService: ProjectService
  let environmentService: EnvironmentService
  let userService: UserService
  let eventService: EventService

  let user1: User, user2: User
  let workspace1: Workspace
  let project1: Project
  let environment1: Environment, environment2: Environment

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule,
        EventModule,
        ProjectModule,
        EnvironmentModule,
        UserModule
      ]
    })
      .overrideProvider(MAIL_SERVICE)
      .useClass(MockMailService)
      .compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter()
    )
    prisma = moduleRef.get(PrismaService)
    projectService = moduleRef.get(ProjectService)
    eventService = moduleRef.get(EventService)
    environmentService = moduleRef.get(EnvironmentService)
    userService = moduleRef.get(UserService)

    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  beforeEach(async () => {
    const createUser1 = await userService.createUser({
      email: 'johndoe@keyshade.xyz',
      name: 'John Doe',
      isOnboardingFinished: true
    })

    const createUser2 = await userService.createUser({
      email: 'janedoe@keyshade.xyz',
      name: 'Jane Doe',
      isOnboardingFinished: true
    })

    workspace1 = createUser1.defaultWorkspace

    delete createUser1.defaultWorkspace
    delete createUser2.defaultWorkspace

    user1 = createUser1
    user2 = createUser2

    project1 = (await projectService.createProject(user1, workspace1.id, {
      name: 'Project 1',
      description: 'Project 1 description',
      storePrivateKey: true,
      environments: [
        {
          name: 'Environment 1',
          description: 'Default environment',
          isDefault: true
        },
        {
          name: 'Environment 2',
          description: 'Environment 2 description'
        }
      ],
      accessLevel: ProjectAccessLevel.PRIVATE
    })) as Project

    environment1 = await prisma.environment.findUnique({
      where: {
        projectId_name: {
          projectId: project1.id,
          name: 'Environment 1'
        }
      }
    })

    environment2 = await prisma.environment.findUnique({
      where: {
        projectId_name: {
          projectId: project1.id,
          name: 'Environment 2'
        }
      }
    })
  })

  afterEach(async () => {
    await prisma.$transaction([
      prisma.user.deleteMany(),
      prisma.workspace.deleteMany()
    ])
  })

  it('should be defined', () => {
    expect(app).toBeDefined()
    expect(prisma).toBeDefined()
  })

  it('should be able to create an environment under a project', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/environment/${project1.id}`,
      payload: {
        name: 'Environment 3',
        description: 'Environment 3 description',
        isDefault: true
      },
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().name).toBe('Environment 3')
    expect(response.json().description).toBe('Environment 3 description')
    expect(response.json().isDefault).toBe(true)

    const environmentFromDb = await prisma.environment.findUnique({
      where: {
        id: response.json().id
      }
    })

    expect(environmentFromDb).toBeDefined()
  })

  it('should ensure there is only one default environment per project', async () => {
    const environments = await prisma.environment.findMany({
      where: {
        projectId: project1.id
      }
    })

    expect(environments.filter((e) => e.isDefault).length).toBe(1)
  })

  it('should not be able to create an environment in a project that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/environment/123`,
      payload: {
        name: 'Environment 1',
        description: 'Environment 1 description',
        isDefault: true
      },
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().message).toBe('Project with id 123 not found')
  })

  it('should not be able to create an environment in a project that the user does not have access to', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/environment/${project1.id}`,
      payload: {
        name: 'Environment 1',
        description: 'Environment 1 description',
        isDefault: true
      },
      headers: {
        'x-e2e-user-email': user2.email
      }
    })

    expect(response.statusCode).toBe(401)
    expect(response.json().message).toBe(
      `User with id ${user2.id} does not have the authority in the project with id ${project1.id}`
    )
  })

  it('should not be able to create a duplicate environment', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/environment/${project1.id}`,
      payload: {
        name: 'Environment 1',
        description: 'Environment 1 description',
        isDefault: true
      },
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().message).toBe(
      `Environment with name Environment 1 already exists in project ${project1.name} (${project1.id})`
    )
  })

  it('should not make other environments non-default if the current environment is not the default one', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/environment/${project1.id}`,
      payload: {
        name: 'Environment 3',
        description: 'Environment 3 description',
        isDefault: false
      },
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().name).toBe('Environment 3')
    expect(response.json().description).toBe('Environment 3 description')
    expect(response.json().isDefault).toBe(false)

    const environments = await prisma.environment.findMany({
      where: {
        projectId: project1.id
      }
    })

    expect(environments.length).toBe(3)
    expect(environments.filter((e) => e.isDefault).length).toBe(1)
  })

  it('should have created a ENVIRONMENT_ADDED event', async () => {
    // Create an environment
    await environmentService.createEnvironment(
      user1,
      {
        name: 'Environment 4'
      },
      project1.id
    )

    const response = await fetchEvents(
      eventService,
      user1,
      workspace1.id,
      EventSource.ENVIRONMENT
    )

    const event = response[0]

    expect(event.source).toBe(EventSource.ENVIRONMENT)
    expect(event.triggerer).toBe(EventTriggerer.USER)
    expect(event.severity).toBe(EventSeverity.INFO)
    expect(event.type).toBe(EventType.ENVIRONMENT_ADDED)
    expect(event.workspaceId).toBe(workspace1.id)
    expect(event.itemId).toBeDefined()
  })

  it('should be able to update an environment', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/environment/${environment1.id}`,
      payload: {
        name: 'Environment 1 Updated',
        description: 'Environment 1 description updated'
      },
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      id: environment1.id,
      name: 'Environment 1 Updated',
      description: 'Environment 1 description updated',
      isDefault: true,
      projectId: project1.id,
      lastUpdatedById: user1.id,
      lastUpdatedBy: expect.any(Object),
      secrets: [],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      pendingCreation: false,
      project: expect.any(Object)
    })

    environment1 = response.json()
  })

  it('should not be able to update an environment that does not exist', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/environment/123`,
      payload: {
        name: 'Environment 1 Updated',
        description: 'Environment 1 description updated'
      },
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().message).toBe('Environment with id 123 not found')
  })

  it('should not be able to update an environment that the user does not have access to', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/environment/${environment1.id}`,
      payload: {
        name: 'Environment 1 Updated',
        description: 'Environment 1 description updated'
      },
      headers: {
        'x-e2e-user-email': user2.email
      }
    })

    expect(response.statusCode).toBe(401)
    expect(response.json().message).toBe(
      `User ${user2.id} does not have the required authorities`
    )
  })

  it('should not be able to update an environment to a duplicate name', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/environment/${environment1.id}`,
      payload: {
        name: 'Environment 2',
        description: 'Environment 1 description updated'
      },
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().message).toBe(
      `Environment with name Environment 2 already exists in project ${project1.id}`
    )
  })

  it('should create a ENVIRONMENT_UPDATED event', async () => {
    // Update an environment
    await environmentService.updateEnvironment(
      user1,
      {
        name: 'Environment 1 Updated'
      },
      environment1.id
    )

    const response = await fetchEvents(
      eventService,
      user1,
      workspace1.id,
      EventSource.ENVIRONMENT
    )

    const event = response[0]

    expect(event.source).toBe(EventSource.ENVIRONMENT)
    expect(event.triggerer).toBe(EventTriggerer.USER)
    expect(event.severity).toBe(EventSeverity.INFO)
    expect(event.type).toBe(EventType.ENVIRONMENT_UPDATED)
    expect(event.workspaceId).toBe(workspace1.id)
    expect(event.itemId).toBeDefined()
  })

  it('should make other environments non-default if the current environment is the default one', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/environment/${environment2.id}`,
      payload: {
        name: 'Environment 2 Updated',
        description: 'Environment 2 description updated',
        isDefault: true
      },
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().name).toBe('Environment 2 Updated')
    expect(response.json().description).toBe(
      'Environment 2 description updated'
    )
    expect(response.json().isDefault).toBe(true)

    const environments = await prisma.environment.findMany({
      where: {
        projectId: project1.id
      }
    })

    expect(environments.length).toBe(2)
    expect(environments.filter((e) => e.isDefault).length).toBe(1)

    environment2 = response.json()
    environment1.isDefault = false
  })

  it('should be able to fetch an environment', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/environment/${environment1.id}`,
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().name).toBe('Environment 1')
    expect(response.json().description).toBe('Default environment')
    expect(response.json().isDefault).toBe(true)
  })

  it('should not be able to fetch an environment that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/environment/123`,
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().message).toBe('Environment with id 123 not found')
  })

  it('should not be able to fetch an environment that the user does not have access to', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/environment/${environment1.id}`,
      headers: {
        'x-e2e-user-email': user2.email
      }
    })

    expect(response.statusCode).toBe(401)
    expect(response.json().message).toBe(
      `User ${user2.id} does not have the required authorities`
    )
  })

  it('should be able to fetch all environments of a project', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/environment/all/${project1.id}`,
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(200)
  })

  it('should not be able to fetch all environments of a project that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/environment/all/123`,
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().message).toBe('Project with id 123 not found')
  })

  it('should not be able to fetch all environments of a project that the user does not have access to', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/environment/all/${project1.id}`,
      headers: {
        'x-e2e-user-email': user2.email
      }
    })

    expect(response.statusCode).toBe(401)
    expect(response.json().message).toBe(
      `User with id ${user2.id} does not have the authority in the project with id ${project1.id}`
    )
  })

  it('should be able to delete an environment', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/environment/${environment2.id}`,
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(200)
  })

  it('should have created a ENVIRONMENT_DELETED event', async () => {
    // Delete an environment
    await environmentService.deleteEnvironment(user1, environment2.id)

    const response = await fetchEvents(
      eventService,
      user1,
      workspace1.id,
      EventSource.ENVIRONMENT
    )

    const event = response[0]

    expect(event.source).toBe(EventSource.ENVIRONMENT)
    expect(event.triggerer).toBe(EventTriggerer.USER)
    expect(event.severity).toBe(EventSeverity.INFO)
    expect(event.type).toBe(EventType.ENVIRONMENT_DELETED)
    expect(event.workspaceId).toBe(workspace1.id)
    expect(event.itemId).toBeDefined()
  })

  it('should not be able to delete an environment that does not exist', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/environment/123`,
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().message).toBe('Environment with id 123 not found')
  })

  it('should not be able to delete an environment that the user does not have access to', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/environment/${environment2.id}`,
      headers: {
        'x-e2e-user-email': user2.email
      }
    })

    expect(response.statusCode).toBe(401)
    expect(response.json().message).toBe(
      `User ${user2.id} does not have the required authorities`
    )
  })

  it('should not be able to delete the default environment of a project', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/environment/${environment1.id}`,
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().message).toBe(
      'Cannot delete the default environment'
    )
  })

  it('should not be able to make the only environment non-default', async () => {
    await prisma.environment.deleteMany({
      where: {
        projectId: project1.id,
        isDefault: false
      }
    })

    const response = await app.inject({
      method: 'PUT',
      url: `/environment/${environment1.id}`,
      payload: {
        isDefault: false
      },
      headers: {
        'x-e2e-user-email': user1.email
      }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().message).toBe(
      'Cannot make the last environment non-default'
    )
  })
})
