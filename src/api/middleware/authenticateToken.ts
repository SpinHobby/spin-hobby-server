import jwt from 'jsonwebtoken';

export default function authenticateToken(req: { headers: { [x: string]: any }; user: any }, res: { sendStatus: (arg0: number) => any }, next: () => void) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  console.log(authHeader, token)

  if (token == null) return res.sendStatus(401)

  jwt.verify(token, 'secret' as string, (err: any, user: any) => {
    console.log(err)

    if (err) return res.sendStatus(403)

    req.user = user

    next()
  })
}