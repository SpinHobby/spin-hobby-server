const multer  = require('multer');

const fileStorageEngine = multer.diskStorage({
  destination: (req: any, file: any, callback: (arg0: null, arg1: string) => void) => {

    callback(null, "./images");

  },
  filename: (req: any, file: any, callback: (arg0: null, arg1: string) => void) => {

    callback(null, "user" + req.body.userId + Date.now());
    
  }
});

const upload = multer({storage: fileStorageEngine});

export default upload;