import { NextResponse } from 'next/server'
import { generateMatchup } from '../../../../../lib/battles/matchupGenerator'
import { getSession } from '@/app/utils/auth'
import { getAllProjects } from '../../../../../lib/battles/airtable'
import { kv } from '@vercel/kv'

export const dynamic = 'force-dynamic'

const PROJECT_CHUNK_SIZE = 50
async function pullFromRedis() {
  const chunkCount = await kv.get('projects.size')

  if (!chunkCount) {
    return null
  }
  if (typeof chunkCount !== 'number') {
    return null
  }

  const chunks = await Promise.all(
    Array.from({ length: chunkCount }, (_, i) => kv.get(`projects.${i}`)),
  )
  return chunks.flat()
}
async function setToRedis(projectsArr: Ships[]) {
  const chunkCount = Math.ceil(projectsArr.length / PROJECT_CHUNK_SIZE)
  await kv.set('projects.size', chunkCount, { ex: 60 })
  for (let i = 0; i < projectsArr.length; i += PROJECT_CHUNK_SIZE) {
    await kv.set(
      `projects.${i / PROJECT_CHUNK_SIZE}`,
      projectsArr.slice(i, i + PROJECT_CHUNK_SIZE),
      { ex: 60 },
    )
  }
}

async function getCachedProjects() {
  const alreadyCached = await pullFromRedis()
  if (alreadyCached) {
    return alreadyCached
  }
  const projects = await getAllProjects()
  await setToRedis(projects)
  return projects
}

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const projects = await getCachedProjects()
    const userSlackId = session.slackId

    // TODO: this filtering could happen in the generateMatchup function!
    const votableProjects = projects.filter(
      (project) => project?.['entrant__slack_id']?.[0] !== userSlackId,
    )
    const matchup = await generateMatchup(votableProjects, userSlackId)

    if (!matchup) {
      return NextResponse.json(
        { error: 'No valid matchup found' },
        { status: 404 },
      )
    }
    const rMatchup = {
      project1: {
        id: matchup.project1.id,
        title: matchup.project1.title,
        screenshot_url: matchup.project1.screenshot_url,
        readme_url: matchup.project1.readme_url,
        repo_url: matchup.project1.repo_url,
        deploy_url: matchup.project1.deploy_url,
        rating: matchup.project1.rating,
        ship_type: matchup.project1.ship_type,
        update_description: matchup.project1.update_description,
      },
      project2: {
        id: matchup.project2.id,
        title: matchup.project2.title,
        screenshot_url: matchup.project2.screenshot_url,
        readme_url: matchup.project2.readme_url,
        repo_url: matchup.project2.repo_url,
        deploy_url: matchup.project2.deploy_url,
        rating: matchup.project2.rating,
        ship_type: matchup.project2.ship_type,
        update_description: matchup.project2.update_description,
      },
      signature: matchup.signature,
      ts: matchup.ts,
    }

    return NextResponse.json(rMatchup)
  } catch (error) {
    console.error('Error generating matchup:', error)
    return NextResponse.json(
      { error: 'Failed to generate matchup' },
      { status: 500 },
    )
  }
}
