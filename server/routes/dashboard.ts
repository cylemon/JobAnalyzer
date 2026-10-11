import { Hono } from 'hono'
import { getDb } from '../db/client'
import { computeDashboard } from '../services/dashboard'

/** 综合看板：纯本地聚合，零 Token。 */

export const dashboardRoute = new Hono()

dashboardRoute.get('/', (c) => c.json(computeDashboard(getDb())))
