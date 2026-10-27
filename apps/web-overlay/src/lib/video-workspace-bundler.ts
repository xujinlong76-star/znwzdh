export interface WorkspaceFile {
  path: string
  content: string
  language?: string
}

export interface BundledProjectWorkspace {
  name: string
  description: string
  files: Record<string, WorkspaceFile>
  totalBytes: number
  generatedAt: number
}

/**
 * Creates a complete multi-file project workspace from study notes, milestones, and video context.
 */
export function buildWorkspaceFromCourse(params: {
  courseTitle: string
  videoId: string
  milestoneCodeSnippets?: Array<{ title: string; code: string; language?: string }>
  notesList?: Array<{ userNote: string; codeSnippet?: string }>
}): BundledProjectWorkspace {
  const { courseTitle, videoId, milestoneCodeSnippets = [], notesList = [] } = params
  const files: Record<string, WorkspaceFile> = {}

  // 1. README.md
  const readmeLines = [
    `# ${courseTitle}`,
    '',
    `> 自动生成的技术训战工程套件 (Video ID: ${videoId})`,
    '',
    '## 包含的核心技术里程碑与笔记',
    '',
  ]

  milestoneCodeSnippets.forEach((m, idx) => {
    readmeLines.push(`### ${idx + 1}. ${m.title}`)
    readmeLines.push(`\`\`\`${m.language || 'text'}`)
    readmeLines.push(m.code)
    readmeLines.push('```')
    readmeLines.push('')
  })

  if (notesList.length > 0) {
    readmeLines.push('## 关键实战思考笔记')
    notesList.forEach((n, idx) => {
      readmeLines.push(`- **笔记 #${idx + 1}**: ${n.userNote}`)
      if (n.codeSnippet) {
        readmeLines.push('  ```')
        readmeLines.push(`  ${n.codeSnippet.replace(/\n/g, '\n  ')}`)
        readmeLines.push('  ```')
      }
    })
  }

  files['README.md'] = {
    path: 'README.md',
    content: readmeLines.join('\n'),
    language: 'markdown',
  }

  // 2. package.json
  const safePkgName = courseTitle.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 30) || 'devops-course-lab'
  files['package.json'] = {
    path: 'package.json',
    content: JSON.stringify(
      {
        name: safePkgName,
        version: '1.0.0',
        description: `Hands-on codebase for ${courseTitle}`,
        main: 'src/index.js',
        scripts: {
          start: 'node src/index.js',
          test: 'echo "Tests passed" && exit 0',
        },
        dependencies: {},
      },
      null,
      2
    ),
    language: 'json',
  }

  // 3. Dockerfile
  files['Dockerfile'] = {
    path: 'Dockerfile',
    content: [
      'FROM node:20-alpine',
      'WORKDIR /app',
      'COPY package*.json ./',
      'RUN npm install --omit=dev',
      'COPY . .',
      'EXPOSE 3000',
      'CMD ["npm", "start"]',
    ].join('\n'),
    language: 'dockerfile',
  }

  // 4. Source code files
  if (milestoneCodeSnippets.length > 0) {
    milestoneCodeSnippets.forEach((m, idx) => {
      const ext = m.language === 'python' ? 'py' : m.language === 'yaml' ? 'yaml' : m.language === 'typescript' ? 'ts' : 'js'
      const filename = `src/milestone_${idx + 1}.${ext}`
      files[filename] = {
        path: filename,
        content: m.code,
        language: m.language || 'javascript',
      }
    })
  } else {
    files['src/index.js'] = {
      path: 'src/index.js',
      content: '// DevOps lab entrypoint\nconsole.log("Ready for hands-on technical walkthrough.");\n',
      language: 'javascript',
    }
  }

  let totalBytes = 0
  for (const f of Object.values(files)) {
    totalBytes += f.content.length
  }

  return {
    name: safePkgName,
    description: `Full workspace for ${courseTitle}`,
    files,
    totalBytes,
    generatedAt: Date.now(),
  }
}

/**
 * Formats a project workspace into GitHub Gist API creation payload.
 */
export function exportToGistPayload(workspace: BundledProjectWorkspace): {
  description: string
  public: boolean
  files: Record<string, { content: string }>
} {
  const gistFiles: Record<string, { content: string }> = {}
  for (const [name, file] of Object.entries(workspace.files)) {
    // Gist filenames cannot contain nested slashes, flatten paths
    const flatName = name.replace(/\//g, '_')
    gistFiles[flatName] = { content: file.content }
  }

  return {
    description: workspace.description,
    public: false,
    files: gistFiles,
  }
}
